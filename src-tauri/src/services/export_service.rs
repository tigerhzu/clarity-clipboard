//! Deterministic, read-only exports shared by the UI, CLI and MCP.
use chrono::{Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportOptions {
    pub start_date: String,
    pub end_date: String,
    pub output_directory: String,
    #[serde(default = "default_storage")]
    pub storage: String,
    #[serde(default)]
    pub tag: Option<String>,
    // Accept the short-lived 1.0.17 option for old scripts. Both values now use
    // the corrected overview + category layout; date choice is made in Excel.
    #[serde(default)]
    pub group_by: ExportGrouping,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportGrouping {
    #[default]
    Type,
    Date,
}
fn default_storage() -> String {
    "history".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub directory: String,
    pub csv_path: String,
    pub xlsx_path: String,
    pub sheet_count: usize,
    pub embedded_image_count: usize,
    pub item_count: usize,
    pub row_count: usize,
    pub image_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Clone)]
pub struct ExportService {
    directory: PathBuf,
}

struct Record {
    storage: String,
    id: String,
    title: String,
    content: String,
    kind: String,
    created: i64,
    source: String,
    image: Option<String>,
    tags: Vec<String>,
    folder: String,
}

fn date_bounds(start: &str, end: &str) -> Result<(i64, i64), String> {
    let parse = |value: &str| -> Result<NaiveDate, String> {
        let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| "日期格式必須為 YYYY-MM-DD")?;
        if date.format("%Y-%m-%d").to_string() != value {
            return Err("日期格式必須為 YYYY-MM-DD".into());
        }
        Ok(date)
    };
    let (start, end) = (parse(start)?, parse(end)?);
    if start > end {
        return Err("開始日期不可晚於結束日期".into());
    }
    let midnight = |date: NaiveDate| {
        Local
            .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .map(|date| date.timestamp_millis())
            .ok_or_else(|| "此日期在本機時區沒有午夜時間".to_owned())
    };
    Ok((
        midnight(start)?,
        midnight(end.succ_opt().ok_or("結束日期超出範圍")?)?,
    ))
}

fn tags(raw: &str, kind: &str) -> Vec<String> {
    let values = serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_else(|_| raw.split([',', ';', '|']).map(str::to_owned).collect());
    let mut tags: BTreeSet<String> = values
        .into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .collect();
    if tags.is_empty() {
        tags.insert(kind.to_owned());
    }
    tags.into_iter().collect()
}

// Quote every field, preserve newlines and prevent Excel formula execution.
fn csv_row(writer: &mut impl Write, fields: &[&str]) -> std::io::Result<()> {
    for (index, value) in fields.iter().enumerate() {
        if index > 0 {
            writer.write_all(b",")?;
        }
        writer.write_all(b"\"")?;
        if value.trim_start().starts_with(['=', '+', '-', '@'])
            || value.starts_with(['\t', '\r', '\n'])
        {
            writer.write_all(b"'")?;
        }
        writer.write_all(value.replace('"', "\"\"").as_bytes())?;
        writer.write_all(b"\"")?;
    }
    writer.write_all(b"\r\n")
}

impl ExportService {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn export(&self, options: ExportOptions) -> Result<ExportResult, String> {
        let (start, end) = date_bounds(&options.start_date, &options.end_date)?;
        if !["history", "folder", "personal", "all"].contains(&options.storage.as_str()) {
            return Err("不支援的 storage".into());
        }
        let output = Path::new(&options.output_directory);
        if !output.is_absolute() {
            return Err("請指定匯出資料夾的完整絕對路徑".into());
        }
        self.write_export(&options, start, end, output)
            .map_err(|error| error.to_string())
    }

    fn write_export(
        &self,
        options: &ExportOptions,
        start: i64,
        end: i64,
        output: &Path,
    ) -> Result<ExportResult, Box<dyn std::error::Error>> {
        // Never create/migrate the DB, run retention or start clipboard capture in CLI mode.
        let mut connection = Connection::open_with_flags(
            self.directory.join("clipboard.db"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        let transaction = connection.transaction()?;
        let mut statement = transaction.prepare(
            "SELECT * FROM (
             SELECT 'history' AS storage, id, COALESCE(custom_name, '') AS title, COALESCE(content, '') AS content,
               content_type, created_at, COALESCE(source_app, '') AS source, file_path, COALESCE(tags, '') AS tags, '' AS folder
               FROM clipboard_items
             UNION ALL SELECT 'personal', id, title, COALESCE(content, ''), content_type, created_at,
               COALESCE(source_app, ''), file_path, COALESCE(tags, ''), '' FROM personal_items
             UNION ALL SELECT 'folder', i.id, COALESCE(i.custom_name, ''), COALESCE(i.content, ''), i.content_type,
               i.created_at, COALESCE(i.source_app, ''), i.file_path, COALESCE(i.tags, ''), f.name
               FROM folder_items i JOIN folders f ON f.id = i.folder_id)
             WHERE created_at >= ?1 AND created_at < ?2 AND (?3 = 'all' OR storage = ?3)
             ORDER BY created_at, storage, id")?;
        let records = statement
            .query_map(params![start, end, options.storage], |row| {
                let kind: String = row.get(4)?;
                Ok(Record {
                    storage: row.get(0)?,
                    id: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    tags: tags(&row.get::<_, String>(8)?, &kind),
                    kind,
                    created: row.get(5)?,
                    source: row.get(6)?,
                    image: row.get(7)?,
                    folder: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let filter = options
            .tag
            .as_deref()
            .map(str::trim)
            .filter(|tag| !tag.is_empty());
        let records: Vec<_> = records
            .into_iter()
            .filter(|record| filter.is_none_or(|tag| record.tags.iter().any(|value| value == tag)))
            .collect();
        fs::create_dir_all(output)?;
        let name = format!(
            "clarity-{}-{}-{}",
            options.start_date,
            options.end_date,
            uuid::Uuid::new_v4()
        );
        let final_path = output.join(&name);
        let staging = final_path.clone();
        fs::create_dir(&staging)?;
        // Publish completion only via the final manifest, not a directory rename.
        // OneDrive/Windows can deny renaming newly populated directories.
        fs::create_dir(staging.join("images"))?;
        let mut result = ExportResult {
            directory: final_path.to_string_lossy().into(),
            csv_path: final_path.join("clipboard.csv").to_string_lossy().into(),
            xlsx_path: final_path.join("clipboard.xlsx").to_string_lossy().into(),
            sheet_count: 0,
            embedded_image_count: 0,
            item_count: records.len(),
            row_count: 0,
            image_count: 0,
            warnings: vec![],
        };
        let image_root = self.directory.join("images").canonicalize().ok();
        let mut image_paths = Vec::new();
        for (index, record) in records.iter().enumerate() {
            let mut relative = String::new();
            if record.kind == "IMAGE" {
                let copy = (|| -> Result<String, Box<dyn std::error::Error>> {
                    let source =
                        Path::new(record.image.as_deref().ok_or("沒有原圖路徑")?).canonicalize()?;
                    if !image_root
                        .as_ref()
                        .is_some_and(|root| source.starts_with(root))
                    {
                        return Err("原圖不在管理的圖片目錄".into());
                    }
                    let relative = format!("images/{:06}.png", index + 1);
                    fs::copy(source, staging.join(&relative))?;
                    Ok(relative)
                })();
                match copy {
                    Ok(path) => {
                        relative = path;
                        result.image_count += 1;
                    }
                    Err(error) => result.warnings.push(format!(
                        "{}/{}：圖片未匯出：{error}",
                        record.storage, record.id
                    )),
                }
            }
            image_paths.push(relative);
        }
        let mut rows = Vec::new();
        for (index, record) in records.iter().enumerate() {
            for tag in &record.tags {
                if filter.is_none_or(|filter| tag == filter) {
                    rows.push((tag, index));
                }
            }
        }
        rows.sort_by(|a, b| a.0.cmp(b.0).then(a.1.cmp(&b.1)));
        let mut writer = BufWriter::new(fs::File::create(staging.join("clipboard.csv"))?);
        writer.write_all(b"\xEF\xBB\xBF")?;
        csv_row(
            &mut writer,
            &[
                "tag",
                "tags",
                "storage",
                "folder",
                "id",
                "created_at",
                "content_type",
                "title",
                "content",
                "source_app",
                "image_path",
                "image_status",
            ],
        )?;
        for (tag, index) in rows {
            let record = &records[index];
            let created = Local
                .timestamp_millis_opt(record.created)
                .single()
                .ok_or("項目時間超出範圍")?
                .to_rfc3339();
            let status = if record.kind != "IMAGE" {
                ""
            } else if image_paths[index].is_empty() {
                "missing"
            } else {
                "copied"
            };
            csv_row(
                &mut writer,
                &[
                    tag,
                    &serde_json::to_string(&record.tags)?,
                    &record.storage,
                    &record.folder,
                    &record.id,
                    &created,
                    &record.kind,
                    &record.title,
                    &record.content,
                    &record.source,
                    &image_paths[index],
                    status,
                ],
            )?;
            result.row_count += 1;
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        write_workbook(&staging, &records, &image_paths, options, &mut result)?;
        let manifest = serde_json::json!({"status":"complete", "result":result, "startDate":options.start_date,"endDate":options.end_date,"storage":options.storage,"tag":options.tag,"layout":"dateOverviewAndTypes","startMs":start,"endExclusiveMs":end,"timeZone":"system local","dateField":"created_at","formulaProtection":"apostrophe prefix","version":env!("CARGO_PKG_VERSION")});
        fs::write(
            staging.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        Ok(result)
    }
}

// Fixed, local categories: no AI classification and no user-controlled sheet names.
fn category(kind: &str) -> (&'static str, u32, u32) {
    match kind {
        "IMAGE" => ("圖片", 0x7C3AED, 0xF3EEFF),
        "TEXT" => ("文字", 0x2563EB, 0xEFF6FF),
        "URL" => ("網址", 0x0F766E, 0xECFDF5),
        "CODE" => ("程式碼", 0x4338CA, 0xEEF2FF),
        "JSON" => ("JSON", 0x6D28D9, 0xF5F3FF),
        "COMMAND" => ("指令", 0x475569, 0xF1F5F9),
        "EMAIL" => ("Email", 0xBE185D, 0xFDF2F8),
        "IP" => ("IP", 0x0369A1, 0xF0F9FF),
        "FILE_PATH" => ("檔案路徑", 0xB45309, 0xFFFBEB),
        "NETWORK_PATH" => ("網路路徑", 0xC2410C, 0xFFF7ED),
        _ => ("其他", 0x475569, 0xF1F5F9),
    }
}

fn write_workbook(
    staging: &Path,
    records: &[Record],
    image_paths: &[String],
    options: &ExportOptions,
    result: &mut ExportResult,
) -> Result<(), Box<dyn std::error::Error>> {
    use rust_xlsxwriter::{Color, Format, FormatAlign, Image, ObjectMovement, Workbook};
    let mut workbook = Workbook::new();
    // Always put a mixed-type overview first; date selection happens inside Excel.
    let mut groups: Vec<(String, u32, Vec<(usize, &Record)>)> = vec![(
        "日期總覽".into(),
        0xA68A64,
        records.iter().enumerate().collect(),
    )];
    for kind in [
        "IMAGE",
        "TEXT",
        "URL",
        "CODE",
        "JSON",
        "COMMAND",
        "EMAIL",
        "IP",
        "FILE_PATH",
        "NETWORK_PATH",
        "OTHER",
    ] {
        let (name, accent, _) = category(kind);
        let members: Vec<_> = records
            .iter()
            .enumerate()
            .filter(|(_, r)| category(&r.kind).0 == name)
            .collect();
        if !members.is_empty() {
            groups.push((name.to_owned(), accent, members));
        }
    }
    for (name, accent, members) in groups {
        let overview = name == "日期總覽";
        let offset: u16 = if overview { 1 } else { 0 };
        let image_column = 3 + offset;
        let sheet = workbook.add_worksheet();
        sheet
            .set_name(&name)?
            .set_tab_color(Color::RGB(accent))
            .set_screen_gridlines(false);
        let base = Format::new()
            .set_font_name("Microsoft JhengHei")
            .set_font_size(11)
            .set_font_color(Color::RGB(0x514537))
            .set_align(FormatAlign::Top)
            .set_text_wrap();
        let title = base
            .clone()
            .set_bold()
            .set_font_size(18)
            .set_background_color(Color::RGB(0xEEE4D6));
        let subtitle = base
            .clone()
            .set_font_color(Color::RGB(0x6E6255))
            .set_background_color(Color::RGB(0xFFFCF7));
        let header = base
            .clone()
            .set_bold()
            .set_background_color(Color::RGB(0xF1E9DD));
        let even = base.clone().set_background_color(Color::RGB(0xFFFCF7));
        let odd = base.clone().set_background_color(Color::RGB(0xF8F2E9));
        sheet.merge_range(
            0,
            0,
            0,
            9 + offset,
            &format!("{name}  ·  {} 筆", members.len()),
            &title,
        )?;
        sheet.merge_range(
            1,
            0,
            1,
            9 + offset,
            &format!(
                "{} ～ {}（本機時間）  ·  {}",
                options.start_date,
                options.end_date,
                if overview {
                    "請用「日期」欄的下拉選單選日期；清除篩選可查看全部，分類分頁不受影響。"
                } else {
                    "圖片可直接查看；長文完整內容見同資料夾文字檔"
                }
            ),
            &subtitle,
        )?;
        sheet
            .set_row_height(0, 36)?
            .set_row_height(1, 30)?
            .set_row_height(2, 27)?;
        for (column, width) in [11.0, 23.0, 26.0, 64.0, 22.0, 24.0, 14.0, 24.0, 38.0, 42.0]
            .iter()
            .enumerate()
        {
            sheet.set_column_width(column as u16 + offset, *width)?;
        }
        if overview {
            sheet.set_column_width(0, 16)?;
            sheet.write_string_with_format(2, 0, "日期", &header)?;
        }
        for (col, label) in [
            "類型",
            "複製／建立時間",
            "標題",
            "內容／圖片",
            "來源程式",
            "收藏資料夾",
            "儲存區",
            "Tags",
            "原圖／完整文字",
            "項目 ID",
        ]
        .iter()
        .enumerate()
        {
            sheet.write_string_with_format(2, col as u16 + offset, *label, &header)?;
        }
        let mut row = 3u32;
        for (index, record) in members {
            let (type_name, type_color, type_tint) = category(&record.kind);
            let badge = base
                .clone()
                .set_bold()
                .set_font_color(Color::RGB(type_color))
                .set_background_color(Color::RGB(type_tint));
            let format = if (row - 3) % 2 == 0 { &even } else { &odd };
            let created = Local
                .timestamp_millis_opt(record.created)
                .single()
                .ok_or("項目時間超出範圍")?
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            let storage = match record.storage.as_str() {
                "history" => "最近複製",
                "folder" => "收藏資料夾",
                "personal" => "常用片段",
                _ => &record.storage,
            };
            let mut attachment = image_paths[index].clone();
            // Keep rows comfortable to scan, with lossless sidecar text for long values.
            let long_content =
                record.content.chars().count() > 600 || record.content.lines().count() > 12;
            let content = if long_content {
                fs::create_dir_all(staging.join("texts"))?;
                let relative = format!("texts/{:06}.txt", index + 1);
                if overview {
                    fs::write(
                        staging.join(&relative),
                        format!("\u{feff}{}", record.content),
                    )?;
                }
                attachment = if attachment.is_empty() {
                    relative
                } else {
                    format!("{attachment}\n{relative}")
                };
                let excerpt: String = record
                    .content
                    .lines()
                    .take(10)
                    .collect::<Vec<_>>()
                    .join("\n")
                    .chars()
                    .take(500)
                    .collect();
                format!("{excerpt}\n…（完整內容請開啟右側文字檔）")
            } else {
                record.content.clone()
            };
            let tags = record.tags.join("、");
            let mut fields = vec![
                type_name,
                &created,
                &record.title,
                &content,
                &record.source,
                &record.folder,
                storage,
                &tags,
                &attachment,
                &record.id,
            ];
            if overview {
                fields.insert(0, &created[..10]);
            }
            for (col, value) in fields.iter().enumerate() {
                // Explicit strings prevent copied =/+/@ text from becoming formulas.
                let value = if value.chars().count() > 30_000 {
                    fs::create_dir_all(staging.join("texts"))?;
                    let relative = format!(
                        "texts/{:06}-field-{}.txt",
                        index + 1,
                        col - usize::from(offset)
                    );
                    if overview {
                        fs::write(staging.join(&relative), format!("\u{feff}{value}"))?;
                        result.warnings.push(format!(
                            "{}/{}：過長欄位已另存 {relative}",
                            record.storage, record.id
                        ));
                    }
                    format!(
                        "{}\n…（完整欄位見 {relative}）",
                        value.chars().take(500).collect::<String>()
                    )
                } else {
                    (*value).to_owned()
                };
                sheet.write_string_with_format(
                    row,
                    col as u16,
                    value,
                    if col == usize::from(offset) {
                        &badge
                    } else {
                        format
                    },
                )?;
            }
            let lines = content
                .lines()
                .map(|line| {
                    (line
                        .chars()
                        .map(|c| if c.is_ascii() { 1 } else { 2 })
                        .sum::<usize>()
                        / 60
                        + 1) as u32
                })
                .sum::<u32>();
            sheet.set_row_height(row, (lines as f64 * 17.0 + 14.0).clamp(52.0, 300.0))?;
            if record.kind == "IMAGE" {
                sheet.set_row_height(row, 180)?;
                let embedded = if attachment.is_empty() {
                    Err("原圖遺失".to_owned())
                } else {
                    Image::new(staging.join(&image_paths[index]))
                        .map_err(|e| e.to_string())
                        .and_then(|image| {
                            let image = image
                                .set_scale_to_size(420, 220, true)
                                .set_alt_text("剪貼簿圖片")
                                .set_object_movement(ObjectMovement::MoveAndSizeWithCells);
                            sheet
                                .insert_image_with_offset(row, image_column, &image, 8, 8)
                                .map(|_| ())
                                .map_err(|e| e.to_string())
                        })
                };
                match embedded {
                    Ok(()) => {
                        sheet.write_blank(row, image_column, format)?;
                        if overview {
                            result.embedded_image_count += 1;
                        }
                    }
                    Err(error) => {
                        sheet.write_string_with_format(
                            row,
                            image_column,
                            "圖片無法顯示，請查看匯出警告。",
                            format,
                        )?;
                        if overview && !image_paths[index].is_empty() {
                            result.warnings.push(format!(
                                "{}/{}：圖片無法嵌入 Excel：{error}",
                                record.storage, record.id
                            ));
                        }
                    }
                }
            }
            row += 1;
        }
        if overview {
            if records.is_empty() {
                sheet.write_string_with_format(3, 0, "此日期範圍沒有資料。", &even)?;
            } else {
                sheet.autofilter(2, 0, row - 1, 10)?;
            }
        }
        result.sheet_count += 1;
    }
    write_date_filter_package(
        workbook.save_to_buffer()?,
        &staging.join("clipboard.xlsx"),
        records.len(),
    )?;
    Ok(())
}

// rust_xlsxwriter doesn't expose per-column filter-button visibility. Patch only
// our generated sheet1 XML using the standard OOXML hiddenButton/showButton
// attributes. Keep the filter range across ALL columns so sorting cannot detach
// dates from their records. Other ZIP parts (including images) are copied intact.
fn write_date_filter_package(
    bytes: Vec<u8>,
    path: &Path,
    count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    if count == 0 {
        fs::write(path, bytes)?;
        return Ok(());
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
    let mut output = zip::ZipWriter::new(fs::File::create(path)?);
    let mut patched = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if entry.name()? == "xl/worksheets/sheet1.xml" {
            let mut xml = String::new();
            entry.read_to_string(&mut xml)?;
            let range = format!("A3:K{}", count + 3);
            let original = format!("<autoFilter ref=\"{range}\"/>");
            if xml.matches(&original).count() != 1 {
                return Err("無法建立日期篩選控制項".into());
            }
            let buttons: String = (1..=10)
                .map(|col| {
                    format!("<filterColumn colId=\"{col}\" hiddenButton=\"1\" showButton=\"0\"/>")
                })
                .collect();
            let replacement = format!("<autoFilter ref=\"{range}\">{buttons}</autoFilter>");
            output.start_file(
                entry.name()?,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )?;
            output.write_all(xml.replace(&original, &replacement).as_bytes())?;
            patched = true;
        } else {
            output.raw_copy_file(entry)?;
        }
    }
    if !patched {
        return Err("找不到日期總覽工作表".into());
    }
    output.finish()?.sync_all()?;
    Ok(())
}

/// Machine-callable entry point, no AI, network, UI or Hermes permission needed.
pub fn run_cli(args: Vec<String>) -> Result<(), String> {
    let mut values = std::collections::HashMap::new();
    if args.len() % 2 != 0 {
        return Err("用法：--export-excel --start YYYY-MM-DD --end YYYY-MM-DD --output 完整路徑 [--storage history|folder|personal|all] [--tag TAG] [--group-by type|date]".into());
    }
    for pair in args.chunks(2) {
        if ![
            "--start",
            "--end",
            "--output",
            "--storage",
            "--tag",
            "--group-by",
        ]
        .contains(&pair[0].as_str())
            || values.insert(pair[0].as_str(), pair[1].clone()).is_some()
        {
            return Err(format!("未知或重複參數：{}", pair[0]));
        }
    }
    let required = |key: &str| {
        values
            .get(key)
            .cloned()
            .ok_or_else(|| format!("缺少參數 {key}"))
    };
    let options = ExportOptions {
        start_date: required("--start")?,
        end_date: required("--end")?,
        output_directory: required("--output")?,
        storage: values
            .get("--storage")
            .cloned()
            .unwrap_or_else(default_storage),
        tag: values.get("--tag").cloned(),
        group_by: match values
            .get("--group-by")
            .map(String::as_str)
            .unwrap_or("type")
        {
            "type" => ExportGrouping::Type,
            "date" => ExportGrouping::Date,
            _ => return Err("--group-by 必須為 type 或 date".into()),
        },
    };
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let directory = PathBuf::from(std::env::var_os("APPDATA").ok_or("找不到 APPDATA")?)
        .join(&context.config().identifier);
    let result = ExportService::new(directory).export(options)?;
    println!(
        "{}",
        serde_json::to_string(&result).map_err(|e| e.to_string())?
    );
    Ok(())
}

#[tauri::command]
pub async fn export_clipboard_csv(
    service: tauri::State<'_, ExportService>,
    options: ExportOptions,
) -> Result<ExportResult, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.export(options))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_export_directory(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    app.path()
        .document_dir()
        .map(|path| path.join("Clarity Exports").to_string_lossy().into())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn zip_text(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> String {
        let mut text = String::new();
        archive
            .by_name(name)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        text
    }

    #[test]
    fn workbook_has_colored_type_tabs_embedded_images_and_lossless_long_text() {
        let (_temp, service, connection, options) = setup();
        let (start, _) = date_bounds(&options.start_date, &options.end_date).unwrap();
        let image = service.directory.join("images/image.png");
        image::RgbaImage::from_pixel(420, 220, image::Rgba([100, 20, 240, 255]))
            .save(&image)
            .unwrap();
        insert(&connection, "image", start, "IMAGE", image.to_str(), None);
        insert(
            &connection,
            "text",
            start,
            "TEXT",
            None,
            Some("[\"工作\",\"報告\"]"),
        );
        insert(&connection, "url", start, "URL", None, None);
        let long = "完整文字🐯\n".repeat(5000);
        connection.execute("UPDATE clipboard_items SET content=?1,custom_name='=HYPERLINK(\"https://example.com\")' WHERE id='text'", [&long]).unwrap();
        let result = service.export(options).unwrap();
        assert_eq!((result.sheet_count, result.embedded_image_count), (4, 1));
        assert!(result.warnings.is_empty());
        let mut zip = zip::ZipArchive::new(fs::File::open(&result.xlsx_path).unwrap()).unwrap();
        let workbook = zip_text(&mut zip, "xl/workbook.xml");
        for name in ["圖片", "文字", "網址"] {
            assert!(workbook.contains(&format!("name=\"{name}\"")));
        }
        let image_sheet = zip_text(&mut zip, "xl/worksheets/sheet2.xml");
        assert!(image_sheet.contains("tabColor rgb=\"FF7C3AED\""));
        assert!(image_sheet.contains("<drawing r:id="));
        assert!(!image_sheet.contains("<autoFilter"));
        assert!(!image_sheet.contains("<pane"));
        let text_sheet = zip_text(&mut zip, "xl/worksheets/sheet3.xml");
        assert!(!text_sheet.contains("<autoFilter"));
        assert!(!text_sheet.contains("<f>"));
        assert!(
            text_sheet.contains("dimension ref=\"A1:J4\""),
            "Multiple tags must not duplicate workbook rows"
        );
        let strings = zip_text(&mut zip, "xl/sharedStrings.xml");
        assert!(strings.contains("=HYPERLINK"));
        assert!(strings.contains("完整內容請開啟"));
        let styles = zip_text(&mut zip, "xl/styles.xml");
        for color in ["FFEEE4D6", "FFF1E9DD", "FFFFFCF7", "FF514537"] {
            assert!(styles.contains(color));
        }
        for color in ["FF7C3AED", "FF2563EB", "FF0F766E"] {
            assert!(
                !styles.contains(&format!("<fgColor rgb=\"{color}\"")),
                "Strong colors belong to tabs/text, not page fills"
            );
        }
        let mut embedded = vec![];
        zip.by_name("xl/media/image1.png")
            .unwrap()
            .read_to_end(&mut embedded)
            .unwrap();
        assert_eq!(embedded, fs::read(image).unwrap());
        let text_path = fs::read_dir(Path::new(&result.directory).join("texts"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(text_path).unwrap(),
            format!("\u{feff}{long}")
        );
    }

    #[test]
    fn first_sheet_filters_local_dates_and_keeps_category_sheets() {
        let (_temp, service, connection, mut options) = setup();
        // Even the legacy date option must no longer split one sheet per day.
        options.group_by = ExportGrouping::Date;
        let (start, end) = date_bounds(&options.start_date, &options.end_date).unwrap();
        let (second_day, _) = date_bounds("2026-11-02", "2026-11-02").unwrap();
        let image = service.directory.join("images/day.png");
        image::RgbaImage::from_pixel(10, 10, image::Rgba([80, 90, 100, 255]))
            .save(&image)
            .unwrap();
        insert(&connection, "day-one-text", start, "TEXT", None, None);
        insert(
            &connection,
            "day-one-image",
            second_day - 1,
            "IMAGE",
            image.to_str(),
            None,
        );
        insert(&connection, "day-two-url", second_day, "URL", None, None);
        insert(&connection, "day-two-text", end - 1, "TEXT", None, None);
        insert(&connection, "outside", end, "TEXT", None, None);
        let result = service.export(options).unwrap();
        if let Some(path) = std::env::var_os("CLARITY_TEST_WORKBOOK") {
            fs::copy(&result.xlsx_path, path).unwrap();
        }
        assert_eq!(
            (
                result.item_count,
                result.sheet_count,
                result.embedded_image_count
            ),
            (4, 4, 1)
        );
        let mut zip = zip::ZipArchive::new(fs::File::open(&result.xlsx_path).unwrap()).unwrap();
        let workbook = zip_text(&mut zip, "xl/workbook.xml");
        for (name, id) in [("日期總覽", 1), ("圖片", 2), ("文字", 3), ("網址", 4)] {
            assert!(workbook.contains(&format!("name=\"{name}\" sheetId=\"{id}\"")));
        }
        assert!(!workbook.contains("name=\"2026-11-01\""));
        let strings = zip_text(&mut zip, "xl/sharedStrings.xml");
        let string_index = |value: &str| {
            strings
                .split("<si>")
                .skip(1)
                .position(|si| {
                    si.split("</si>")
                        .next()
                        .unwrap()
                        .contains(&format!(">{value}</t>"))
                })
                .unwrap()
        };
        let sheet = zip_text(&mut zip, "xl/worksheets/sheet1.xml");
        assert!(!sheet.contains("<pane"));
        assert!(sheet.contains("<autoFilter ref=\"A3:K7\">"));
        assert_eq!(
            sheet.matches("hiddenButton=\"1\" showButton=\"0\"").count(),
            10
        );
        assert!(!sheet.contains("<filterColumn colId=\"0\""));
        assert!(sheet.contains("<drawing"));
        for id in [
            "day-one-text",
            "day-one-image",
            "day-two-url",
            "day-two-text",
        ] {
            assert!(sheet.contains(&format!("<v>{}</v>", string_index(id))));
        }
        for (cell, date) in [
            ("A4", "2026-11-01"),
            ("A5", "2026-11-01"),
            ("A6", "2026-11-02"),
            ("A7", "2026-11-02"),
        ] {
            let cell_xml = sheet
                .split(&format!("r=\"{cell}\""))
                .nth(1)
                .unwrap()
                .split("</c>")
                .next()
                .unwrap();
            assert!(cell_xml.contains(&format!("<v>{}</v>", string_index(date))));
        }
        for number in 2..=4 {
            assert!(
                !zip_text(&mut zip, &format!("xl/worksheets/sheet{number}.xml")).contains("<pane")
            );
            assert!(
                !zip_text(&mut zip, &format!("xl/worksheets/sheet{number}.xml"))
                    .contains("<autoFilter")
            );
        }
        let drawing = zip_text(&mut zip, "xl/drawings/drawing1.xml");
        assert!(drawing.contains("<xdr:twoCellAnchor>"));
        assert!(drawing.contains("<xdr:col>4</xdr:col>"));
        let styles = zip_text(&mut zip, "xl/styles.xml");
        assert!(styles.contains("FFF8F2E9"));
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(Path::new(&result.directory).join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["layout"], "dateOverviewAndTypes");
    }

    #[test]
    fn corrupt_image_is_reported_without_losing_other_rows() {
        let (_temp, service, connection, options) = setup();
        let (start, _) = date_bounds(&options.start_date, &options.end_date).unwrap();
        let image = service.directory.join("images/broken.png");
        fs::write(&image, "not a PNG").unwrap();
        insert(&connection, "broken", start, "IMAGE", image.to_str(), None);
        insert(&connection, "text", start, "TEXT", None, None);
        let result = service.export(options).unwrap();
        assert_eq!(
            (
                result.item_count,
                result.sheet_count,
                result.embedded_image_count
            ),
            (2, 3, 0)
        );
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("無法嵌入 Excel"));
        assert!(Path::new(&result.xlsx_path).exists());
    }
    fn setup() -> (tempfile::TempDir, ExportService, Connection, ExportOptions) {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        crate::database::repository::ClipboardRepository::initialize(data.join("clipboard.db"))
            .unwrap();
        fs::create_dir(data.join("images")).unwrap();
        let connection = Connection::open(data.join("clipboard.db")).unwrap();
        let options = ExportOptions {
            start_date: "2026-11-01".into(),
            end_date: "2026-11-02".into(),
            output_directory: temp.path().join("exports").to_string_lossy().into(),
            storage: "history".into(),
            tag: None,
            group_by: ExportGrouping::Type,
        };
        (temp, ExportService::new(data), connection, options)
    }
    fn insert(
        connection: &Connection,
        id: &str,
        created: i64,
        kind: &str,
        image: Option<&str>,
        tags: Option<&str>,
    ) {
        connection.execute("INSERT INTO clipboard_items (id, content, content_type, content_hash, created_at, updated_at, file_path, tags) VALUES (?1, ?2, ?3, ?1, ?4, ?4, ?5, ?6)", params![id, "中文,\"引號\"\r\n第二行🐯", kind, created, image, tags]).unwrap();
    }
    #[test]
    fn complete_export_dates_tags_images_and_repeated_runs() {
        let (_temp, service, connection, options) = setup();
        let (start, end) = date_bounds(&options.start_date, &options.end_date).unwrap();
        insert(&connection, "before", start - 1, "TEXT", None, None);
        insert(&connection, "after", end, "TEXT", None, None);
        for i in 0..1001 {
            insert(
                &connection,
                &format!("text-{i}"),
                start,
                "TEXT",
                None,
                Some("[\"工作\",\"工作\",\"報告\"]"),
            );
        }
        let image = service.directory.join("images/image.png");
        image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255]))
            .save(&image)
            .unwrap();
        insert(&connection, "image", end - 1, "IMAGE", image.to_str(), None);
        insert(&connection, "missing", start, "IMAGE", None, None);
        let result = service.export(options.clone()).unwrap();
        assert_eq!(
            (
                result.item_count,
                result.row_count,
                result.image_count,
                result.warnings.len()
            ),
            (1003, 2004, 1, 1)
        );
        let csv = fs::read_to_string(&result.csv_path).unwrap();
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("中文,\"\"引號\"\"\r\n第二行🐯"));
        assert!(!csv.contains("\"before\""));
        assert!(!csv.contains("\"after\""));
        assert!(csv.contains("\"missing\""));
        let copied = fs::read_dir(Path::new(&result.directory).join("images"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(fs::read(copied).unwrap(), fs::read(image).unwrap());
        let again = service.export(options.clone()).unwrap();
        assert_ne!(result.directory, again.directory);
        assert_eq!(csv, fs::read_to_string(again.csv_path).unwrap());
        let filtered = service
            .export(ExportOptions {
                tag: Some("工作".into()),
                ..options
            })
            .unwrap();
        assert_eq!((filtered.item_count, filtered.row_count), (1001, 1001));
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM clipboard_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1005);
    }
    #[test]
    fn all_storages_and_empty_export() {
        let (_temp, service, connection, mut options) = setup();
        let (start, _) = date_bounds(&options.start_date, &options.end_date).unwrap();
        connection.execute("INSERT INTO personal_items (id,title,content_type,content_hash,created_at,updated_at) VALUES ('p','標題','TEXT','p',?1,?1)", [start]).unwrap();
        connection
            .execute(
                "INSERT INTO folders (id,name,created_at,updated_at) VALUES ('f','收藏',?1,?1)",
                [start],
            )
            .unwrap();
        connection.execute("INSERT INTO folder_items (id,folder_id,content_type,content_hash,created_at,updated_at) VALUES ('f1','f','URL','f1',?1,?1)", [start]).unwrap();
        assert_eq!(service.export(options.clone()).unwrap().item_count, 0);
        options.storage = "all".into();
        let result = service.export(options.clone()).unwrap();
        assert_eq!(result.item_count, 2);
        assert!(fs::read_to_string(result.csv_path)
            .unwrap()
            .contains("收藏"));
        for storage in ["personal", "folder"] {
            options.storage = storage.into();
            assert_eq!(service.export(options.clone()).unwrap().item_count, 1);
        }
    }
    #[test]
    fn invalid_inputs_and_unmanaged_image_are_safe() {
        let (temp, service, connection, options) = setup();
        assert!(date_bounds("2026-11-03", "2026-11-01").is_err());
        assert!(date_bounds("2026-02-30", "2026-11-01").is_err());
        assert!(date_bounds("2026-1-1", "2026-11-01").is_err());
        assert!(service
            .export(ExportOptions {
                storage: "invalid".into(),
                ..options.clone()
            })
            .is_err());
        assert!(service
            .export(ExportOptions {
                output_directory: "relative".into(),
                ..options.clone()
            })
            .is_err());
        assert!(!Path::new(&options.output_directory).exists());
        let outside = temp.path().join("outside.png");
        fs::write(&outside, "private").unwrap();
        let (start, _) = date_bounds(&options.start_date, &options.end_date).unwrap();
        insert(
            &connection,
            "outside",
            start,
            "IMAGE",
            outside.to_str(),
            None,
        );
        let result = service.export(options.clone()).unwrap();
        assert_eq!(result.image_count, 0);
        assert_eq!(result.warnings.len(), 1);
        assert!(ExportService::new(temp.path().join("missing"))
            .export(options)
            .is_err());
        assert!(!temp.path().join("missing").exists());
    }
    #[test]
    fn csv_escaping_and_formula_protection() {
        let mut bytes = Vec::new();
        csv_row(
            &mut bytes,
            &["=1+1", " +cmd", "-1", "@SUM(A1)", "\ttext", "a,\"b\"\nc"],
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "\"'=1+1\",\"' +cmd\",\"'-1\",\"'@SUM(A1)\",\"'\ttext\",\"a,\"\"b\"\"\nc\"\r\n"
        );
    }
}

//! Private loopback transport; Hermes sees only standard newline-delimited MCP stdio.
//! Frames are bounded length-prefixed JSON, not an HTTP endpoint usable by a website.
use super::ToolServices;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

const MAX_FRAME: usize = 8 * 1024 * 1024;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Descriptor {
    port: u16,
    token: String,
}

pub struct Bridge {
    stopped: Arc<AtomicBool>,
    descriptor: PathBuf,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        let _ = fs::remove_file(&self.descriptor);
    }
}

impl Bridge {
    pub fn start(directory: &Path, services: ToolServices) -> Result<Self, String> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let descriptor = Descriptor {
            port: listener.local_addr().map_err(|e| e.to_string())?.port(),
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        };
        let path = directory.join("hermes-bridge.json");
        super::persist_json(&path, &descriptor)?;
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        thread::Builder::new()
            .name("hermes-bridge".into())
            .spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut stream, address)) => {
                            if !address.ip().is_loopback() {
                                continue;
                            }
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                            let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
                            if let Ok(envelope) = read_frame(&mut stream, MAX_FRAME) {
                                let request = &envelope["request"];
                                let response = if envelope["token"].as_str()
                                    != Some(descriptor.token.as_str())
                                {
                                    super::tools::rpc_error(
                                        request["id"].clone(),
                                        -32001,
                                        "未授權的本機連線",
                                    )
                                } else {
                                    super::tools::handle_rpc(&services, request)
                                };
                                if let Some(response) = response {
                                    let _ = write_frame(&mut stream, &response, MAX_RESPONSE);
                                }
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(30))
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| {
                let _ = fs::remove_file(&path);
                e.to_string()
            })?;
        Ok(Self {
            stopped,
            descriptor: path,
        })
    }
}

fn read_frame(reader: &mut impl Read, maximum: usize) -> Result<Value, String> {
    let mut length = [0; 4];
    reader.read_exact(&mut length).map_err(|e| e.to_string())?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > maximum {
        return Err("MCP 訊息超過大小限制".into());
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn write_frame(writer: &mut impl Write, value: &Value, maximum: usize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > maximum {
        return Err("MCP 回應超過大小限制；請縮小查詢".into());
    }
    writer
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .map_err(|e| e.to_string())?;
    writer.write_all(&bytes).map_err(|e| e.to_string())
}

fn forward(path: &Path, request: &Value) -> Result<Option<Value>, String> {
    // Reload every call: application restarts rotate port/token without changing Hermes config.
    let descriptor: Descriptor = serde_json::from_slice(
        &fs::read(path).map_err(|_| "請開啟新版剪貼後台，並在設定 → Hermes 啟用串接")?,
    )
    .map_err(|_| "剪貼後台連線資訊無效，請重新啟動剪貼後台")?;
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, descriptor.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|_| "無法連線；請確認剪貼後台正在同一台電腦、同一 Windows 使用者下執行")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;
    write_frame(
        &mut stream,
        &json!({"token": descriptor.token, "request": request}),
        MAX_FRAME,
    )?;
    if request.get("id").is_none() {
        return Ok(None);
    }
    Ok(Some(read_frame(&mut stream, MAX_RESPONSE)?))
}

pub fn run_stdio(path: &Path) -> Result<(), String> {
    let mut input = BufReader::new(std::io::stdin().lock());
    let mut output = std::io::stdout().lock();
    loop {
        let mut line = Vec::new();
        let read = input
            .by_ref()
            .take((MAX_FRAME + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(());
        }
        if line.len() > MAX_FRAME || line.last() != Some(&b'\n') {
            return Err("MCP stdio 訊息超過大小限制或缺少換行".into());
        }
        let response = match serde_json::from_slice::<Value>(&line) {
            Ok(request) => match forward(path, &request) {
                Ok(response) => response,
                Err(error) if request.get("id").is_some() => {
                    super::tools::rpc_error(request["id"].clone(), -32000, &error)
                }
                Err(_) => None,
            },
            Err(_) => super::tools::rpc_error(Value::Null, -32700, "無效的 JSON"),
        };
        if let Some(response) = response {
            serde_json::to_writer(&mut output, &response).map_err(|e| e.to_string())?;
            output.write_all(b"\n").map_err(|e| e.to_string())?;
            output.flush().map_err(|e| e.to_string())?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authenticated_bridge_and_restart_discovery() {
        let (directory, services, _) = super::super::tools::tests::setup();
        let request = super::super::tools::tests::request("clarity_status", json!({}));
        let first = Bridge::start(directory.path(), services.clone()).unwrap();
        let path = directory.path().join("hermes-bridge.json");
        let before: Descriptor = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let result = forward(&path, &request).unwrap().unwrap();
        assert_eq!(result["result"]["isError"], false);
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, before.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write_frame(
            &mut stream,
            &json!({"token":"wrong","request":request}),
            MAX_FRAME,
        )
        .unwrap();
        assert_eq!(
            read_frame(&mut stream, MAX_RESPONSE).unwrap()["error"]["code"],
            -32001
        );
        drop(first);
        assert!(!path.exists());
        assert!(forward(&path, &request).is_err());
        let _second = Bridge::start(directory.path(), services).unwrap();
        let after: Descriptor = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_ne!(before.token, after.token);
        assert_eq!(
            forward(&path, &request).unwrap().unwrap()["result"]["isError"],
            false
        );
    }
    #[test]
    fn rejects_oversized_and_malformed_frames_before_allocating() {
        assert!(read_frame(
            &mut std::io::Cursor::new((MAX_FRAME as u32 + 1).to_be_bytes()),
            MAX_FRAME
        )
        .is_err());
        assert!(read_frame(&mut std::io::Cursor::new([0, 0, 0, 0]), MAX_FRAME).is_err());
        assert!(read_frame(&mut std::io::Cursor::new([0, 0, 0, 1, b'?']), MAX_FRAME).is_err());
    }
}

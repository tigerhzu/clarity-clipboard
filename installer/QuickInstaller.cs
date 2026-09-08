using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("剪貼 · Clarity 安裝程式")]
[assembly: AssemblyDescription("快速安裝剪貼 · Clarity")]
[assembly: AssemblyCompany("Tiger Hsu")]
[assembly: AssemblyProduct("剪貼 · Clarity")]
[assembly: AssemblyCopyright("著作權所有 © 2026 Tiger Hsu")]

internal static class QuickInstaller
{
    private const string PayloadResource = "Clarity.Setup.Payload";
    private const string MutexName = "Local\\ClarityClipboard.QuickInstaller";

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [STAThread]
    private static int Main(string[] args)
    {
        if (Environment.OSVersion.Version.Major >= 6)
        {
            SetProcessDPIAware();
        }

        if (args.Length == 1 && string.Equals(args[0], "--verify-payload", StringComparison.OrdinalIgnoreCase))
        {
            return VerifyPayload() ? 0 : 1;
        }

        bool ownsMutex;
        using (var mutex = new Mutex(true, MutexName, out ownsMutex))
        {
            if (!ownsMutex)
            {
                MessageBox.Show("安裝程式已經在執行。", "剪貼 · Clarity", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new InstallerWindow())
            {
                Application.Run(window);
                return window.ExitCode;
            }
        }
    }

    private static bool VerifyPayload()
    {
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
        {
            return payload != null && payload.Length > 100000;
        }
    }

    private sealed class InstallerWindow : Form
    {
        private readonly Label status;
        private readonly ProgressBar progress;

        public int ExitCode { get; private set; }

        public InstallerWindow()
        {
            Text = "剪貼 · Clarity";
            ClientSize = new Size(420, 148);
            BackColor = Color.FromArgb(12, 13, 18);
            ForeColor = Color.FromArgb(236, 236, 241);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                // Windows will use the executable icon automatically.
            }

            var title = new Label
            {
                AutoSize = true,
                Font = new Font("Segoe UI Semibold", 13F, FontStyle.Regular, GraphicsUnit.Point),
                ForeColor = Color.FromArgb(245, 245, 248),
                Location = new Point(24, 22),
                Text = "正在安裝剪貼 · Clarity"
            };

            status = new Label
            {
                AutoEllipsis = true,
                Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point),
                ForeColor = Color.FromArgb(163, 164, 177),
                Location = new Point(25, 58),
                Size = new Size(370, 22),
                Text = "正在準備應用程式…"
            };

            progress = new ProgressBar
            {
                Location = new Point(25, 96),
                MarqueeAnimationSpeed = 18,
                Size = new Size(370, 6),
                Style = ProgressBarStyle.Marquee
            };

            Controls.Add(title);
            Controls.Add(status);
            Controls.Add(progress);
            Shown += OnShown;
            FormClosing += OnFormClosing;
        }

        private async void OnShown(object sender, EventArgs eventArgs)
        {
            try
            {
                await Task.Run((Action)InstallPayload);
                status.Text = "安裝完成，正在開啟 Clarity…";
                progress.Style = ProgressBarStyle.Continuous;
                progress.Value = 100;
                await Task.Delay(450);
                ExitCode = 0;
                Close();
            }
            catch (Exception error)
            {
                ExitCode = 1;
                progress.Style = ProgressBarStyle.Continuous;
                progress.Value = 0;
                status.Text = "無法完成安裝";
                MessageBox.Show(
                    "安裝沒有完成。請稍後再試，或確認 Clarity 目前沒有正在執行。\r\n\r\n" + error.Message,
                    "剪貼 · Clarity",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Close();
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs eventArgs)
        {
            if (ExitCode == 0 && progress.Style == ProgressBarStyle.Marquee)
            {
                eventArgs.Cancel = true;
            }
        }

        private void InstallPayload()
        {
            string tempDirectory = Path.Combine(Path.GetTempPath(), "Clarity-Setup-" + Guid.NewGuid().ToString("N"));
            string setupPath = Path.Combine(tempDirectory, "Clarity-NSIS-Setup.exe");

            try
            {
                UpdateStatus("正在安全關閉背景中的 Clarity…");
                StopInstalledApp();
                UpdateStatus("正在複製應用程式與建立捷徑…");

                Directory.CreateDirectory(tempDirectory);
                using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
                {
                    if (payload == null)
                    {
                        throw new InvalidOperationException("找不到內嵌的應用程式安裝檔。");
                    }

                    using (var output = new FileStream(setupPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        payload.CopyTo(output);
                    }
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = setupPath,
                    Arguments = "/S /R",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WorkingDirectory = tempDirectory
                };

                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        throw new InvalidOperationException("無法啟動應用程式安裝程序。");
                    }

                    process.WaitForExit();
                    if (process.ExitCode != 0)
                    {
                        throw new InvalidOperationException("安裝程序傳回錯誤代碼 " + process.ExitCode + "。");
                    }
                }
            }
            finally
            {
                try
                {
                    if (File.Exists(setupPath))
                    {
                        File.Delete(setupPath);
                    }

                    if (Directory.Exists(tempDirectory))
                    {
                        Directory.Delete(tempDirectory, false);
                    }
                }
                catch
                {
                    // Windows will clear temporary files later if another process still has a handle.
                }
            }
        }

        private void UpdateStatus(string message)
        {
            if (!IsHandleCreated || IsDisposed)
            {
                return;
            }

            BeginInvoke((Action)(() => status.Text = message));
        }

        private static void StopInstalledApp()
        {
            try
            {
                using (var quitSignal = EventWaitHandle.OpenExisting("Local\\ClarityClipboard.Quit"))
                {
                    quitSignal.Set();
                }
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                // Versions installed before the quick installer do not expose the signal.
            }

            string installedExecutable = Path.GetFullPath(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "剪貼後台",
                "clarity-clipboard.exe"));

            foreach (var process in Process.GetProcessesByName("clarity-clipboard"))
            {
                using (process)
                {
                    string processPath;
                    try
                    {
                        processPath = Path.GetFullPath(process.MainModule.FileName);
                    }
                    catch
                    {
                        continue;
                    }

                    if (!string.Equals(processPath, installedExecutable, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (process.WaitForExit(5000))
                    {
                        continue;
                    }

                    // One-time fallback for versions that predate the graceful quit event.
                    process.Kill();
                    if (!process.WaitForExit(5000))
                    {
                        throw new InvalidOperationException("無法關閉正在執行的 Clarity。");
                    }
                }
            }
        }
    }
}

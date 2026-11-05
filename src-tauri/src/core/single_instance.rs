//! Acquire the process gate before creating any window, database or monitor.
//! A named auto-reset event preserves activation requests during cold startup.
use std::{ffi::OsStr, io, os::windows::ffi::OsStrExt, ptr, thread};
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0},
    System::Threading::{CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, INFINITE},
};

// Kernel handles may be moved between threads; store their address as usize.
struct OwnedHandle(usize);

impl OwnedHandle {
    fn raw(&self) -> HANDLE {
        self.0 as HANDLE
    }
    fn new(handle: HANDLE) -> io::Result<Self> {
        if handle.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(handle as usize))
        }
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.raw());
        }
    }
}

pub struct SingleInstance {
    _gate: OwnedHandle,
    activate: OwnedHandle,
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

impl SingleInstance {
    /// None means an existing process was notified and this launch must exit.
    pub fn acquire(identifier: &str) -> io::Result<Option<Self>> {
        // Create/open the event first so even an activation before setup is retained.
        let event_name = wide(&format!("Local\\{identifier}.Activate"));
        let activate =
            OwnedHandle::new(unsafe { CreateEventW(ptr::null(), 0, 0, event_name.as_ptr()) })?;
        let gate_name = wide(&format!("Local\\{identifier}.Instance"));
        let handle = unsafe { CreateMutexW(ptr::null(), 0, gate_name.as_ptr()) };
        let already_exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        let gate = OwnedHandle::new(handle)?;
        if already_exists {
            if unsafe { SetEvent(activate.raw()) } == 0 {
                return Err(io::Error::last_os_error());
            }
            return Ok(None);
        }
        Ok(Some(Self {
            _gate: gate,
            activate,
        }))
    }

    pub fn listen(self, app: tauri::AppHandle) -> io::Result<()> {
        thread::Builder::new()
            .name("single-instance-activation".into())
            .spawn(move || {
                // Keep both handles, including the process gate, alive for the entire loop.
                let instance = self;
                while unsafe { WaitForSingleObject(instance.activate.raw(), INFINITE) }
                    == WAIT_OBJECT_0
                {
                    crate::show_main_window(&app);
                }
                // An activation listener failure must not release the gate in a live app.
                app.exit(1);
                loop {
                    thread::park();
                }
            })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicates_signal_before_listener_starts_and_gate_releases_on_exit() {
        let id = format!("clarity-test-{}", uuid::Uuid::new_v4());
        let first = SingleInstance::acquire(&id).unwrap().unwrap();
        assert!(SingleInstance::acquire(&id).unwrap().is_none());
        assert_eq!(
            unsafe { WaitForSingleObject(first.activate.raw(), 1000) },
            WAIT_OBJECT_0
        );
        assert!(SingleInstance::acquire(&id).unwrap().is_none());
        drop(first);
        assert!(SingleInstance::acquire(&id).unwrap().is_some());
    }

    #[test]
    fn simultaneous_launches_have_exactly_one_owner() {
        let id = format!("clarity-test-{}", uuid::Uuid::new_v4());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let threads = (0..8)
            .map(|_| {
                let id = id.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    let instance = SingleInstance::acquire(&id).unwrap();
                    barrier.wait();
                    instance
                })
            })
            .collect::<Vec<_>>();
        let instances = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            instances
                .iter()
                .filter(|instance| instance.is_some())
                .count(),
            1
        );
    }
}

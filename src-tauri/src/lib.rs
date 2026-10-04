use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
struct RecoverySnapshot {
    updated_at: u64,
    source_path: Option<String>,
    drawing: String,
}

fn app_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(name))
}

fn modified_at(path: &str) -> Result<Option<u64>, String> {
    match fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata
                .modified()
                .map_err(|error| error.to_string())?
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?;
            Ok(Some(modified.as_millis() as u64))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn remember_path(mut recent: Vec<String>, path: String) -> Vec<String> {
    recent.retain(|item| item != &path);
    recent.insert(0, path);
    recent.truncate(8);
    recent
}

#[tauri::command]
fn read_drawing(path: String) -> Result<String, String> {
    if !path.to_lowercase().ends_with(".excalidraw") {
        return Err("Only .excalidraw files can be opened".into());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn drawing_modified_at(path: String) -> Result<Option<u64>, String> {
    modified_at(&path)
}

#[tauri::command]
fn write_drawing(path: String, contents: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".excalidraw") {
        return Err("Only .excalidraw files can be saved".into());
    }
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_recovery(app: AppHandle) -> Result<Option<RecoverySnapshot>, String> {
    let path = app_file(&app, "recovery.json")?;
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn write_recovery(app: AppHandle, snapshot: RecoverySnapshot) -> Result<(), String> {
    let path = app_file(&app, "recovery.json")?;
    let contents = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let path = app_file(&app, "recovery.json")?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn read_recent_files(app: AppHandle) -> Result<Vec<String>, String> {
    let path = app_file(&app, "recent-files.json")?;
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn remember_file(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let recent = remember_path(read_recent_files(app.clone())?, path);
    let target = app_file(&app, "recent-files.json")?;
    let contents = serde_json::to_string(&recent).map_err(|error| error.to_string())?;
    fs::write(target, contents).map_err(|error| error.to_string())?;
    Ok(recent)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_drawing,
            drawing_modified_at,
            write_drawing,
            read_recovery,
            write_recovery,
            clear_recovery,
            read_recent_files,
            remember_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Excalidraw Desktop");
}

#[cfg(test)]
mod tests {
    use super::{modified_at, read_drawing, remember_path, write_drawing};
    use std::fs;

    #[test]
    fn recent_paths_move_to_front_and_stay_unique() {
        let recent = remember_path(vec!["a".into(), "b".into(), "c".into()], "b".into());
        assert_eq!(recent, vec!["b", "a", "c"]);
    }

    #[test]
    fn recent_paths_are_limited_to_eight() {
        let recent = (0..10).map(|n| n.to_string()).collect();
        let recent = remember_path(recent, "new.excalidraw".into());
        assert_eq!(recent.len(), 8);
        assert_eq!(recent[0], "new.excalidraw");
    }

    #[test]
    fn missing_drawing_has_no_modification_time() {
        let path = std::env::temp_dir().join(format!("missing-{}.excalidraw", std::process::id()));
        let _ = fs::remove_file(&path);
        assert_eq!(modified_at(path.to_str().unwrap()).unwrap(), None);
    }

    #[test]
    fn existing_drawing_has_modification_time() {
        let path = std::env::temp_dir().join(format!("drawing-{}.excalidraw", std::process::id()));
        fs::write(&path, "{}").unwrap();
        let modified = modified_at(path.to_str().unwrap()).unwrap();
        fs::remove_file(path).unwrap();
        assert!(modified.is_some());
    }

    #[test]
    fn drawing_contents_round_trip_without_formatting_changes() {
        let path =
            std::env::temp_dir().join(format!("round-trip-{}.excalidraw", std::process::id()));
        let contents = r#"{"type":"excalidraw","elements":[],"appState":{},"files":{}}"#;
        write_drawing(path.to_string_lossy().into_owned(), contents.into()).unwrap();
        assert_eq!(
            read_drawing(path.to_string_lossy().into_owned()).unwrap(),
            contents
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn drawing_commands_reject_other_extensions() {
        assert!(read_drawing("drawing.json".into()).is_err());
        assert!(write_drawing("drawing.json".into(), "{}".into()).is_err());
    }
}

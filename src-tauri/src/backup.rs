use std::fs;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};

use tauri::{command, AppHandle, Manager};

use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipArchive;
use zip::ZipWriter;

/// 临时目录清理 guard：无论成功失败，Drop 时自动删除，避免失败路径残留
struct TempDirGuard(PathBuf);

impl TempDirGuard {
    fn new(path: PathBuf) -> Self {
        Self(path)
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// 临时文件清理 guard
struct TempFileGuard(PathBuf);

impl TempFileGuard {
    fn new(path: PathBuf) -> Self {
        Self(path)
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[command]
pub async fn import_app_data_from_file(
    app_handle: AppHandle,
    _file_name: String,
    file_content: Vec<u8>,
) -> Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    // 整个数据目录的解压/复制是重 I/O，放到 blocking 线程执行
    tauri::async_runtime::spawn_blocking(move || import_app_data_from_bytes(&data_dir, &file_content))
        .await
        .map_err(|e| format!("Failed to join import task: {}", e))?
}

fn import_app_data_from_bytes(data_dir: &Path, file_content: &[u8]) -> Result<(), String> {
    // 将文件内容保存到临时文件
    let temp_zip_path = data_dir.join("temp_import.zip");
    fs::write(&temp_zip_path, file_content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    let _temp_zip_guard = TempFileGuard::new(temp_zip_path.clone());

    // 创建临时目录用于解压
    let temp_dir = data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let _temp_dir_guard = TempDirGuard::new(temp_dir.clone());

    // 使用 zip crate 解压
    extract_zip(&temp_zip_path, &temp_dir)?;

    apply_imported_data(&temp_dir, data_dir)
}

#[command]
pub async fn export_app_data(app_handle: AppHandle, output_path: String) -> Result<String, String> {
    // 获取数据目录
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    if !data_dir.exists() {
        return Err(format!("Data directory does not exist: {:?}", data_dir));
    }

    // 尝试直接保存到用户选择的路径
    let dest_path = PathBuf::from(&output_path);

    // 压缩整个数据目录是重 I/O，放到 blocking 线程执行
    let write_result = {
        let data_dir = data_dir.clone();
        let dest_path = dest_path.clone();
        tauri::async_runtime::spawn_blocking(move || compress_dir(&data_dir, &dest_path))
            .await
            .map_err(|e| format!("Failed to join export task: {}", e))?
    };

    match write_result {
        Ok(_) => Ok(dest_path.to_string_lossy().to_string()),
        Err(_e) => {
            // 如果失败，尝试保存到 document_dir
            let export_dir = app_handle
                .path()
                .document_dir()
                .map_err(|e| format!("Failed to get document_dir: {}", e))?;

            let file_name = PathBuf::from(&output_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "note-gen-backup.zip".to_string());

            let new_dest_path = export_dir.join(&file_name);

            {
                let data_dir = data_dir.clone();
                let new_dest_path = new_dest_path.clone();
                tauri::async_runtime::spawn_blocking(move || compress_dir(&data_dir, &new_dest_path))
                    .await
                    .map_err(|e| format!("Failed to join export task: {}", e))??;
            }

            Ok(new_dest_path.to_string_lossy().to_string())
        }
    }
}

#[command]
pub async fn import_app_data(app_handle: AppHandle, zip_path: String) -> Result<(), String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;

    // 整个数据目录的解压/复制是重 I/O，放到 blocking 线程执行
    tauri::async_runtime::spawn_blocking(move || import_app_data_sync(&data_dir, &zip_path))
        .await
        .map_err(|e| format!("Failed to join import task: {}", e))?
}

fn import_app_data_sync(data_dir: &Path, zip_path: &str) -> Result<(), String> {
    // 创建临时目录用于解压
    let temp_dir = data_dir.join("temp_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let _temp_dir_guard = TempDirGuard::new(temp_dir.clone());

    // 使用 zip crate 解压
    extract_zip(PathBuf::from(zip_path).as_path(), &temp_dir)?;

    apply_imported_data(&temp_dir, data_dir)
}

// 把解压到临时目录的内容复制回数据目录
fn apply_imported_data(temp_dir: &Path, data_dir: &Path) -> Result<(), String> {
    // 处理 store.json
    let store_path = temp_dir.join("store.json");
    if store_path.exists() {
        let dest_store_path = data_dir.join("store.json");
        fs::copy(&store_path, &dest_store_path)
            .map_err(|e| format!("Failed to copy store.json: {}", e))?;
    }

    // 复制其他文件
    for entry in
        fs::read_dir(temp_dir).map_err(|e| format!("Failed to read temp directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name();

        if file_name == "store.json" {
            continue;
        }

        // 跳过 SQLite 临时文件，让数据库重新创建
        let file_name_str = file_name.to_string_lossy();
        if file_name_str.ends_with(".db-shm") || file_name_str.ends_with(".db-wal") {
            continue;
        }

        let src_path = entry.path();
        let dest_path = data_dir.join(&file_name);

        if src_path.is_file() {
            fs::copy(&src_path, &dest_path).map_err(|e| {
                format!("Failed to copy file {}: {}", file_name.to_string_lossy(), e)
            })?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path).map_err(|e| {
                format!(
                    "Failed to copy directory {}: {}",
                    file_name.to_string_lossy(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

// 递归复制目录的辅助函数
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_file() {
            fs::copy(&src_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        }
    }

    Ok(())
}

// 使用 zip crate 压缩目录
fn compress_dir(src_dir: &Path, dest_file: &Path) -> Result<(), String> {
    // 确保父目录存在
    if let Some(parent) = dest_file.parent() {
        if parent != src_dir {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }

    let file =
        fs::File::create(dest_file).map_err(|e| format!("Failed to create zip file: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let base_path = src_dir.to_path_buf();
    add_dir_to_zip(&mut zip, &base_path, &base_path, &options)?;

    zip.finish()
        .map_err(|e| format!("Failed to finish zip: {}", e))?;

    Ok(())
}

fn add_dir_to_zip<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    base_path: &Path,
    current_path: &Path,
    options: &SimpleFileOptions,
) -> Result<(), String> {
    if !current_path.exists() {
        return Ok(());
    }

    for entry in
        fs::read_dir(current_path).map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(base_path)
            .map_err(|e| format!("Failed to get relative path: {}", e))?;

        if path.is_file() {
            let file_name = relative_path.to_string_lossy();
            zip.start_file(file_name, *options)
                .map_err(|e| format!("Failed to start file in zip: {}", e))?;

            let mut file =
                fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
            // 流式写入，避免大文件全量读进内存
            std::io::copy(&mut file, zip)
                .map_err(|e| format!("Failed to write file to zip: {}", e))?;
        } else if path.is_dir() {
            let dir_name = format!("{}/", relative_path.to_string_lossy());
            zip.add_directory(&dir_name, *options)
                .map_err(|e| format!("Failed to add directory to zip: {}", e))?;
            add_dir_to_zip(zip, base_path, &path, options)?;
        }
    }

    Ok(())
}

// 解压 zip 文件
fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read file from zip: {}", e))?;

        let outpath = match file.enclosed_name() {
            Some(path) => dest_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile =
                fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    Ok(())
}

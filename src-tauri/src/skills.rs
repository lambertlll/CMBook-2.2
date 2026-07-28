use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};
use zip::ZipArchive;

/// 内置 skill 标记文件名：写入已安装的内置 skill 目录，前端据此展示"内置"徽章并隐藏删除按钮
const BUILTIN_MARKER_FILE: &str = ".builtin";

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

#[command]
pub async fn import_skill_zip(app_handle: AppHandle, zip_path: String) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // 确保 skills 目录存在
    let skills_dir = app_data_dir.join("skills");
    if !skills_dir.exists() {
        fs::create_dir_all(&skills_dir)
            .map_err(|e| format!("Failed to create skills directory: {}", e))?;
    }

    // 创建临时目录用于解压
    let temp_dir = app_data_dir.join("temp_skill_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let _temp_dir_guard = TempDirGuard::new(temp_dir.clone());

    // 使用 zip crate 解压到临时目录
    let file = fs::File::open(&zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let outpath = temp_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile =
                fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    let skill_root = match find_skill_root(&temp_dir)? {
        Some(path) => path,
        None => {
            return Err(
                "No valid skill found in zip file. A valid skill must contain a SKILL.md file."
                    .to_string(),
            );
        }
    };

    let skill_name = if skill_root == temp_dir {
        Path::new(&zip_path)
            .file_stem()
            .and_then(|n| n.to_str())
            .filter(|n| !n.trim().is_empty())
            .ok_or("Failed to get skill directory name from zip file")?
            .to_string()
    } else {
        skill_root
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Failed to get skill directory name")?
            .to_string()
    };

    let dest_path = skills_dir.join(&skill_name);
    if dest_path.exists() {
        fs::remove_dir_all(&dest_path)
            .map_err(|e| format!("Failed to remove existing skill directory: {}", e))?;
    }

    if skill_root == temp_dir {
        copy_dir_recursive(&skill_root, &dest_path)
            .map_err(|e| format!("Failed to copy skill directory: {}", e))?;
    } else {
        fs::rename(&skill_root, &dest_path)
            .or_else(|_| copy_dir_recursive(&skill_root, &dest_path))
            .map_err(|e| format!("Failed to move skill directory: {}", e))?;
    }

    // 临时目录由 guard 自动清理
    Ok(skill_name)
}

fn find_skill_root(root: &Path) -> Result<Option<PathBuf>, String> {
    if root.join("SKILL.md").is_file() {
        return Ok(Some(root.to_path_buf()));
    }

    let entries = fs::read_dir(root).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() || is_ignored_zip_metadata_dir(&path) {
            continue;
        }

        if let Some(skill_root) = find_skill_root(&path)? {
            return Ok(Some(skill_root));
        }
    }

    Ok(None)
}

fn is_ignored_zip_metadata_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| name == "__MACOSX")
        .unwrap_or(false)
}

// 递归复制目录的辅助函数
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
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

// ============================================================================
// 内置 skill 安装（首次启动把打包资源中的 builtin-skills 复制到 AppData skills/）
// ============================================================================

/// 内置 skill 安装结果（单个 skill）
#[derive(serde::Serialize)]
pub struct BuiltinSkillInstallResult {
    name: String,
    status: String, // installed | updated | skipped
}

/// 定位内置 skill 源目录：
/// - prod：打包进资源目录（tauri.conf.json bundle.resources 数组形式会把 ../ 转为 _up_ 并保留目录结构）
/// - dev：resource_dir 不含资源文件，回退到源码仓库根目录（CARGO_MANIFEST_DIR 的上一级）
fn resolve_builtin_skills_source(app_handle: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        // 数组形式 resources 中 "../builtin-skills" 的落点：$RESOURCE/_up_/builtin-skills
        candidates.push(resource_dir.join("_up_").join("builtin-skills"));
        // 兼容映射形式（若以后改为 { "../builtin-skills": "builtin-skills/" }）
        candidates.push(resource_dir.join("builtin-skills"));
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("builtin-skills"),
    );

    candidates.into_iter().find(|dir| dir.is_dir())
}

/// 比较源目录与目标目录内容是否一致（递归比较相对文件集合与字节内容，忽略 .builtin 标记文件）
fn dir_content_equals(src: &Path, dest: &Path) -> bool {
    let src_files = collect_relative_files(src, src);
    let dest_files: Vec<PathBuf> = collect_relative_files(dest, dest)
        .into_iter()
        .filter(|rel| rel != Path::new(BUILTIN_MARKER_FILE))
        .collect();

    if src_files.len() != dest_files.len() {
        return false;
    }

    src_files.iter().all(|rel| {
        dest_files.contains(rel)
            && fs::read(src.join(rel))
                .map(|a| fs::read(dest.join(rel)).map(|b| a == b).unwrap_or(false))
                .unwrap_or(false)
    })
}

/// 递归收集目录下所有文件的相对路径
fn collect_relative_files(root: &Path, dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(rel) = path.strip_prefix(root) {
                    files.push(rel.to_path_buf());
                }
            } else if path.is_dir() {
                files.extend(collect_relative_files(root, &path));
            }
        }
    }
    files
}

/// 安装内置 skills：把打包资源（dev 模式回退源码目录）中的 builtin-skills 复制到
/// AppData `skills/` 下。已存在同名目录且内容一致则跳过；内容有差异则先把旧目录
/// 重命名为 <名>.bak 备份（.bak 已存在则追加序号，保留可恢复）再覆盖更新
/// （保证版本升级后内置 skill 随之更新）。每个安装目录写入 `.builtin` 标记文件，
/// 记录来源与安装时的应用版本。
#[command]
pub async fn install_builtin_skills(
    app_handle: AppHandle,
) -> Result<Vec<BuiltinSkillInstallResult>, String> {
    let results = tauri::async_runtime::spawn_blocking(move || {
        install_builtin_skills_sync(&app_handle)
    })
    .await
    .map_err(|e| format!("install_builtin_skills task failed: {}", e))??;

    Ok(results)
}

/// 覆盖前把已存在的同名 skill 目录重命名为 <名>.bak 保留可恢复；
/// .bak 已存在时依次尝试 .bak2、.bak3…，返回实际使用的备份路径。
fn backup_existing_skill_dir(skills_dir: &Path, skill_name: &str) -> Result<PathBuf, String> {
    let mut backup = skills_dir.join(format!("{}.bak", skill_name));
    let mut n = 2;
    while backup.exists() {
        backup = skills_dir.join(format!("{}.bak{}", skill_name, n));
        n += 1;
    }
    fs::rename(skills_dir.join(skill_name), &backup)
        .map_err(|e| format!("Failed to backup existing skill dir {}: {}", skill_name, e))?;
    Ok(backup)
}

fn install_builtin_skills_sync(
    app_handle: &AppHandle,
) -> Result<Vec<BuiltinSkillInstallResult>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let skills_dir = app_data_dir.join("skills");
    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    // 源目录缺失（如移动端未打包内置 skills）时不视为错误，返回空列表
    let Some(source_dir) = resolve_builtin_skills_source(app_handle) else {
        return Ok(Vec::new());
    };

    let app_version = app_handle.package_info().version.to_string();
    let mut results = Vec::new();

    let entries = fs::read_dir(&source_dir)
        .map_err(|e| format!("Failed to read builtin skills directory: {}", e))?;

    for entry in entries.flatten() {
        let src_skill_dir = entry.path();
        if !src_skill_dir.is_dir() || !src_skill_dir.join("SKILL.md").is_file() {
            continue;
        }
        let Some(skill_name) = src_skill_dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        let dest_skill_dir = skills_dir.join(skill_name);

        // 已存在且内容一致：跳过（幂等；内容有差异才会走到下面的备份+覆盖分支）
        if dest_skill_dir.is_dir() && dir_content_equals(&src_skill_dir, &dest_skill_dir) {
            results.push(BuiltinSkillInstallResult {
                name: skill_name.to_string(),
                status: "skipped".to_string(),
            });
            continue;
        }

        let status = if dest_skill_dir.exists() {
            // 同名目录可能是用户自建或手动改过的：先重命名为 .bak 备份再覆盖，保留可恢复
            backup_existing_skill_dir(&skills_dir, skill_name)?;
            "updated"
        } else {
            "installed"
        };

        copy_dir_recursive(&src_skill_dir, &dest_skill_dir)
            .map_err(|e| format!("Failed to copy builtin skill {}: {}", skill_name, e))?;

        // 写入 .builtin 标记文件（来源 + 应用版本，供前端识别与后续升级判断）
        let marker = format!(
            "{{\"source\":\"builtin\",\"appVersion\":\"{}\",\"installedAt\":{}}}",
            app_version,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        fs::write(dest_skill_dir.join(BUILTIN_MARKER_FILE), marker)
            .map_err(|e| format!("Failed to write builtin marker: {}", e))?;

        results.push(BuiltinSkillInstallResult {
            name: skill_name.to_string(),
            status: status.to_string(),
        });
    }

    Ok(results)
}

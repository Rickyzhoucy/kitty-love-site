//! 只读的本地文件操作，带路径白名单。
//!
//! ## 闸门为什么在这里，而不在服务端
//!
//! 云端那个 agent 会读联网搜索结果、对方发来的消息、照片描述——**全是不可信
//! 输入**。把「能不能读这个路径」交给它判断，等于把闸门交给一个可能被提示注入
//! 影响的系统。所以服务端那份 `allowedRoots` 只用于在设置页展示，
//! **真正的校验只发生在这个文件里**，在用户自己的机器上。
//!
//! ## 为什么不用 MCP filesystem server
//!
//! 它要求用户机器上有 Node（和「分发给别人自托管」直接冲突），15 个工具里我们
//! 只用 4 个，而且**它自己不做按工具的权限控制**——只读只是个 annotation，
//! 服务器本身不拦。既然闸门无论如何都要自己写，那多一个进程和一个运行时依赖
//! 就不值当了。
//!
//! ## 二期只读；三期放开写时这里要改
//!
//! 现在用 `canonicalize()` + `starts_with()`：前者会解析符号链接，所以
//! 「白名单里放一个软链指向 /etc」这种逃逸会被后者挡下。
//!
//! **但 `canonicalize()` 要求路径已经存在。** 三期要写新文件时它会直接失败，
//! 那时候不能图省事改成「先校验父目录」——父目录校验完到真正写入之间有 TOCTOU
//! 窗口。应该换成 `soft-canonicalize` 或 `path_jail` 这类专门处理不存在路径的库。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 单个文件读取上限。再大的文本塞进模型上下文也没有意义，
/// 而且会把一次对话的成本推得很高。
const MAX_READ_BYTES: u64 = 256 * 1024;

/// 一次列目录/搜索返回的最大条目数。
const MAX_ENTRIES: usize = 500;

#[derive(Debug, Serialize)]
pub struct EntryInfo {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// 修改时间，ISO 8601。取不到就是 None（有些文件系统不给）。
    pub modified: Option<String>,
}

/// 把 `~` 展开成家目录。用户在设置里填 `~/我们的` 是很自然的写法，
/// 模型也可能这么给。
fn expand_tilde(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = dirs_home() {
            return home.join(rest);
        }
    }
    if raw == "~" {
        if let Some(home) = dirs_home() {
            return home;
        }
    }
    PathBuf::from(raw)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// 把请求的路径夹进白名单。返回规范化之后的真实路径。
///
/// **拒绝的理由要能直接给模型看**——「这个路径没有授权」比「Permission denied」
/// 更能让它去调 local_roots 看看能读哪儿，而不是换个写法重试。
pub fn resolve_within(roots: &[String], requested: &str) -> Result<PathBuf, String> {
    if roots.is_empty() {
        return Err("还没有授权任何目录。去桌面版的设置里加一个吧。".into());
    }
    let target = expand_tilde(requested);
    // 先规范化目标：这一步会解析掉 `..` 和符号链接，
    // 所以下面的 starts_with 比较的是真实位置，不是字面路径。
    let real = target
        .canonicalize()
        .map_err(|_| format!("找不到这个路径：{requested}"))?;

    for root in roots {
        let Ok(root_real) = expand_tilde(root).canonicalize() else {
            // 白名单里配了一个已经不存在的目录。跳过，不要因此让整次调用失败
            // ——其他目录还是好的。
            continue;
        };
        if real.starts_with(&root_real) {
            return Ok(real);
        }
    }
    Err(format!(
        "「{requested}」不在授权范围内。用 local_roots 看看能读哪些目录。"
    ))
}

fn describe(path: &Path) -> Option<EntryInfo> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok().and_then(|time| {
        time.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| format_epoch(d.as_secs()))
    });
    Some(EntryInfo {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        is_dir: meta.is_dir(),
        size: meta.len(),
        modified,
    })
}

/// 给别的模块用的时间戳（审计日志）。
pub fn format_epoch_public(secs: u64) -> String {
    format_epoch(secs)
}

/// 不引 chrono，就为了一个时间戳。ISO 8601 的 UTC 形式手算即可。
fn format_epoch(secs: u64) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant 的 civil_from_days。比自己数闰年可靠。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn list(roots: &[String], requested: &str) -> Result<Vec<EntryInfo>, String> {
    let dir = resolve_within(roots, requested)?;
    if !dir.is_dir() {
        return Err(format!("「{requested}」不是一个目录"));
    }
    let mut items: Vec<EntryInfo> = fs::read_dir(&dir)
        .map_err(|e| format!("读不了这个目录：{e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            // 隐藏文件默认不列。宠物没有理由去翻 .ssh / .aws / .git，
            // 而它们恰恰是最不该被读到的东西。
            !entry.file_name().to_string_lossy().starts_with('.')
        })
        .filter_map(|entry| describe(&entry.path()))
        .take(MAX_ENTRIES)
        .collect();
    items.sort_by(|a, b| (b.is_dir, &a.name).cmp(&(a.is_dir, &b.name)));
    Ok(items)
}

pub fn read(roots: &[String], requested: &str) -> Result<String, String> {
    let file = resolve_within(roots, requested)?;
    let meta = fs::metadata(&file).map_err(|e| format!("读不了：{e}"))?;
    if meta.is_dir() {
        return Err(format!("「{requested}」是个目录，不是文件"));
    }
    let bytes = fs::read(&file).map_err(|e| format!("读不了：{e}"))?;
    let truncated = bytes.len() as u64 > MAX_READ_BYTES;
    let slice = &bytes[..bytes.len().min(MAX_READ_BYTES as usize)];
    // 二进制文件读出来是一堆乱码，对模型毫无用处还很费 token。
    // from_utf8 失败就直说，让它换个文件。
    let text = std::str::from_utf8(slice)
        .map_err(|_| format!("「{requested}」看起来是二进制文件，读不了"))?;
    Ok(if truncated {
        format!("{text}\n\n…（文件太大，只读了前 {} KB）", MAX_READ_BYTES / 1024)
    } else {
        text.to_string()
    })
}

pub fn search(
    roots: &[String],
    requested: &str,
    pattern: &str,
) -> Result<Vec<EntryInfo>, String> {
    let dir = resolve_within(roots, requested)?;
    let mut found = Vec::new();
    walk(&dir, pattern, &mut found, 0);
    Ok(found)
}

/// 递归找文件名。深度设了上限——家目录里一个 node_modules 就能让无限递归
/// 跑上几分钟，而那期间整个调用是卡着的。
fn walk(dir: &Path, pattern: &str, out: &mut Vec<EntryInfo>, depth: usize) {
    if depth > 6 || out.len() >= MAX_ENTRIES {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if glob_match(pattern, &name) {
            if let Some(info) = describe(&path) {
                out.push(info);
            }
        }
        if path.is_dir() {
            walk(&path, pattern, out, depth + 1);
        }
        if out.len() >= MAX_ENTRIES {
            return;
        }
    }
}

/// 只支持 `*` 和 `?` 的 glob。不引 glob crate：这里的输入是模型给的
/// 一个简单模式，完整 glob 语义（`**`、字符集、花括号）用不上。
fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0usize, 0usize);
    // star / mark 记住最后一次 `*` 的位置，失配时回溯到那里再多吃一个字符。
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            mark = ni;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// 单个附件的上限。比服务端的 50MB 小得多，因为这条路要把整个文件
/// base64 之后经 IPC 传给网页层——几十兆走这条路会让界面卡住好几秒。
/// 真要传大文件，用聊天框里原来那个上传按钮。
pub const MAX_ATTACH_BYTES: u64 = 10 * 1024 * 1024;

/// 给 `@` 候选用：在**所有**授权目录里按文件名片段找。
///
/// 和 `search` 的区别是不需要先指定目录——用户在输入框里打 `@年度`，
/// 这时候还没有"当前目录"的概念，得把所有授权范围都扫一遍。
pub fn search_all(roots: &[String], query: &str) -> Vec<EntryInfo> {
    let needle = query.trim().to_lowercase();
    let mut found = Vec::new();
    for root in roots {
        let Ok(dir) = expand_tilde(root).canonicalize() else {
            continue;
        };
        collect_files(&dir, &needle, &mut found, 0);
        if found.len() >= CANDIDATE_LIMIT {
            break;
        }
    }
    // 名字短的排前面：打 `readme` 时 `readme.md` 应该在
    // `readme-old-backup-2024.md` 前头。
    found.sort_by_key(|item| item.name.chars().count());
    found.truncate(CANDIDATE_LIMIT);
    found
}

/// 候选列表最多这么多条。菜单里滚不完的候选没有意义。
const CANDIDATE_LIMIT: usize = 20;

fn collect_files(dir: &Path, needle: &str, out: &mut Vec<EntryInfo>, depth: usize) {
    if depth > 5 || out.len() >= CANDIDATE_LIMIT {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            // 这些目录里全是构建产物，不是人写的东西。扫进去只会把候选淹掉，
            // 而且很慢。
            if matches!(name.as_str(), "node_modules" | "target" | "venv" | "__pycache__") {
                continue;
            }
            collect_files(&path, needle, out, depth + 1);
        } else if needle.is_empty() || name.to_lowercase().contains(needle) {
            if let Some(info) = describe(&path) {
                out.push(info);
            }
        }
        if out.len() >= CANDIDATE_LIMIT {
            return;
        }
    }
}

/// 读出文件字节，交给网页层当附件上传。
///
/// **仍然过白名单。** 候选列表是本机生成的，但 `path` 是从网页层传回来的
/// 字符串——中间隔了一层不可信边界，不能因为"候选是我给的"就跳过校验。
pub fn read_for_attach(roots: &[String], requested: &str) -> Result<(String, Vec<u8>), String> {
    let file = resolve_within(roots, requested)?;
    let meta = fs::metadata(&file).map_err(|e| format!("读不了：{e}"))?;
    if meta.is_dir() {
        return Err("这是个文件夹，不能当附件".into());
    }
    if meta.len() > MAX_ATTACH_BYTES {
        return Err(format!(
            "文件太大了（超过 {} MB）。大文件用聊天框里的上传按钮。",
            MAX_ATTACH_BYTES / 1024 / 1024
        ));
    }
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "文件".into());
    let bytes = fs::read(&file).map_err(|e| format!("读不了：{e}"))?;
    Ok((name, bytes))
}

pub fn info(roots: &[String], requested: &str) -> Result<EntryInfo, String> {
    let path = resolve_within(roots, requested)?;
    describe(&path).ok_or_else(|| format!("看不了「{requested}」的信息"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_handles_star_and_question() {
        assert!(glob_match("*.md", "readme.md"));
        assert!(glob_match("2026*", "2026-08-03.txt"));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("*.md", "readme.txt"));
        assert!(glob_match("*", "anything"));
    }

    /// **逃逸测试。** 白名单外的路径必须拒绝，`..` 也不行。
    #[test]
    fn paths_outside_the_roots_are_rejected() {
        let tmp = std::env::temp_dir().join("kitty-jail-test");
        let inside = tmp.join("inside");
        fs::create_dir_all(&inside).unwrap();
        fs::write(inside.join("ok.txt"), b"hi").unwrap();

        let roots = vec![inside.to_string_lossy().into_owned()];
        assert!(resolve_within(&roots, inside.join("ok.txt").to_str().unwrap()).is_ok());
        // 用 .. 跳出去
        let escape = inside.join("../..").to_string_lossy().into_owned();
        assert!(resolve_within(&roots, &escape).is_err());
        // 完全无关的路径
        assert!(resolve_within(&roots, "/etc").is_err());
        // 没有白名单时一律拒绝
        assert!(resolve_within(&[], inside.to_str().unwrap()).is_err());
    }

    /// `@` 候选：只在授权目录里找，且不能把隐藏文件和构建产物翻出来。
    #[test]
    fn candidates_stay_inside_the_roots() {
        let tmp = std::env::temp_dir().join("kitty-candidates-test");
        let _ = fs::remove_dir_all(&tmp);
        let inside = tmp.join("inside");
        fs::create_dir_all(inside.join("node_modules")).unwrap();
        fs::create_dir_all(tmp.join("outside")).unwrap();
        fs::write(inside.join("年度总结.md"), b"x").unwrap();
        fs::write(inside.join("readme.md"), b"x").unwrap();
        fs::write(inside.join(".secret"), b"x").unwrap();
        fs::write(inside.join("node_modules/junk.md"), b"x").unwrap();
        fs::write(tmp.join("outside/别人的.md"), b"x").unwrap();

        let roots = vec![inside.to_string_lossy().into_owned()];
        let names: Vec<String> = search_all(&roots, "md")
            .into_iter()
            .map(|item| item.name)
            .collect();

        assert!(names.contains(&"年度总结.md".to_string()));
        assert!(names.contains(&"readme.md".to_string()));
        // 授权目录外的不该出现——候选列表也是一种信息泄露。
        assert!(!names.iter().any(|n| n == "别人的.md"));
        // node_modules 里全是构建产物，扫进去只会把真正的候选淹掉。
        assert!(!names.iter().any(|n| n == "junk.md"));
        // 隐藏文件永远不出现。
        assert!(!names.iter().any(|n| n.starts_with('.')));
    }

    /// 附件读取也要过白名单——路径是从网页层传回来的，不能因为
    /// 「候选是我给的」就信它。
    #[test]
    fn attachment_read_is_also_jailed() {
        let tmp = std::env::temp_dir().join("kitty-attach-test");
        let _ = fs::remove_dir_all(&tmp);
        let inside = tmp.join("inside");
        fs::create_dir_all(&inside).unwrap();
        fs::write(inside.join("ok.txt"), b"hello").unwrap();
        fs::write(tmp.join("outside.txt"), b"nope").unwrap();

        let roots = vec![inside.to_string_lossy().into_owned()];
        let (name, bytes) =
            read_for_attach(&roots, inside.join("ok.txt").to_str().unwrap()).unwrap();
        assert_eq!(name, "ok.txt");
        assert_eq!(bytes, b"hello");
        assert!(read_for_attach(&roots, tmp.join("outside.txt").to_str().unwrap()).is_err());
    }

    /// 符号链接指向白名单外时也要拒绝——这是 canonicalize 存在的理由。
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape() {
        let tmp = std::env::temp_dir().join("kitty-jail-symlink");
        let inside = tmp.join("inside");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&inside).unwrap();
        let link = inside.join("escape");
        std::os::unix::fs::symlink("/etc", &link).unwrap();

        let roots = vec![inside.to_string_lossy().into_owned()];
        assert!(
            resolve_within(&roots, link.to_str().unwrap()).is_err(),
            "软链逃逸没被挡住——canonicalize 或 starts_with 写错了"
        );
    }
}

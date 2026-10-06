use lazy_static::lazy_static;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use regex::Regex;
use std::collections::HashMap;
use tree_sitter::{Node, Parser};

lazy_static! {
    static ref IPV4_REGEX: Regex = Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap();
    static ref AWS_KEY_REGEX: Regex = Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap();
    static ref PRIVATE_KEY_REGEX: Regex = Regex::new(r"-----BEGIN (?:[A-Z ]+)PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]+?\s*-----END (?:[A-Z ]+)PRIVATE KEY-----").unwrap();
    static ref AUTHORIZATION_REGEX: Regex = Regex::new(r"(?i)\bauthorization\s*[:=]\s*(?:bearer|basic)\s+([A-Za-z0-9._~+/=-]{4,})").unwrap();
    static ref CREDENTIAL_REGEX: Regex = Regex::new(r#"(?i)(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|pass|secret|token|api[_-]?key|access[_-]?key|auth[_-]?key)(\s*[:=]\s*)(["']?)([A-Za-z0-9_!@#$%^&*().,\-+/=~:;?]{4,})(["']?)"#).unwrap();
}

#[napi(object)]
pub struct SanitizeResult {
    pub clean_text: String,
    pub mapping_dict: HashMap<String, String>,
}

#[napi]
pub fn sanitize(text: String) -> Result<SanitizeResult> {
    let mut clean_text = text.clone();
    let mut mapping_dict = HashMap::new();
    let mut ip_count = 1;
    let mut aws_count = 1;
    let mut pkey_count = 1;
    let mut auth_count = 1;
    let mut cred_count = 1;

    // IPv4
    let mut new_text = String::new();
    let mut last_match = 0;
    for caps in IPV4_REGEX.captures_iter(&clean_text) {
        let m = caps.get(0).unwrap();
        // ignore 127.0.0.1 or 0.0.0.0
        let val = m.as_str();
        if val == "127.0.0.1" || val == "0.0.0.0" {
            continue;
        }

        let token = format!("[IP_{}]", ip_count);
        mapping_dict.insert(token.clone(), val.to_string());
        ip_count += 1;

        new_text.push_str(&clean_text[last_match..m.start()]);
        new_text.push_str(&token);
        last_match = m.end();
    }
    new_text.push_str(&clean_text[last_match..]);
    clean_text = new_text;

    // AWS Keys
    new_text = String::new();
    last_match = 0;
    for caps in AWS_KEY_REGEX.captures_iter(&clean_text) {
        let m = caps.get(0).unwrap();
        let val = m.as_str();
        let token = format!("[AWS_KEY_{}]", aws_count);
        mapping_dict.insert(token.clone(), val.to_string());
        aws_count += 1;
        new_text.push_str(&clean_text[last_match..m.start()]);
        new_text.push_str(&token);
        last_match = m.end();
    }
    new_text.push_str(&clean_text[last_match..]);
    clean_text = new_text;

    // Private Keys
    new_text = String::new();
    last_match = 0;
    for caps in PRIVATE_KEY_REGEX.captures_iter(&clean_text) {
        let m = caps.get(0).unwrap();
        let val = m.as_str();
        let token = format!("[PRIVATE_KEY_{}]", pkey_count);
        mapping_dict.insert(token.clone(), val.to_string());
        pkey_count += 1;
        new_text.push_str(&clean_text[last_match..m.start()]);
        new_text.push_str(&token);
        last_match = m.end();
    }
    new_text.push_str(&clean_text[last_match..]);
    clean_text = new_text;

    // Authorization headers (capture group 1 is the credential after Bearer/Basic)
    new_text = String::new();
    last_match = 0;
    for caps in AUTHORIZATION_REGEX.captures_iter(&clean_text) {
        let secret = caps.get(1).unwrap();
        let token = format!("[AUTH_{}]", auth_count);
        mapping_dict.insert(token.clone(), secret.as_str().to_string());
        auth_count += 1;

        new_text.push_str(&clean_text[last_match..secret.start()]);
        new_text.push_str(&token);
        last_match = secret.end();
    }
    new_text.push_str(&clean_text[last_match..]);
    clean_text = new_text;

    // Credentials (capture group 3 is the actual secret)
    new_text = String::new();
    last_match = 0;
    for caps in CREDENTIAL_REGEX.captures_iter(&clean_text) {
        let secret = caps.get(3).unwrap();
        let token = format!("[SECRET_{}]", cred_count);
        mapping_dict.insert(token.clone(), secret.as_str().to_string());
        cred_count += 1;

        new_text.push_str(&clean_text[last_match..secret.start()]);
        new_text.push_str(&token);
        last_match = secret.end();
    }
    new_text.push_str(&clean_text[last_match..]);
    clean_text = new_text;

    Ok(SanitizeResult {
        clean_text,
        mapping_dict,
    })
}

/// Neutral stand-in used wherever a placeholder is compared "before rehydration": bracketed
/// placeholders have Bash syntax of their own (`[ ... ]`), a plain word does not.
const NEUTRAL_WORD: &str = "GETSSH_REDACTED_VALUE";

/// Commands (and `find` actions) that parse a string argument, piped input or stored text as code
/// a second time. A value placed anywhere in such a command line keeps its first-order AST shape
/// (`eval "[SECRET_1]"` is just a string) but can still become syntax when it is evaluated.
/// This is a deny-list: it narrows the gap, it cannot prove a command free of second-order evaluation.
const SECOND_ORDER_WORDS: &[&str] = &[
    "eval", "source", ".", "sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "csh", "tcsh", "ash",
    "busybox", "xargs", "parallel", "ssh", "su", "runuser", "watch", "script", "tmux", "screen",
    "expect", "osascript", "perl", "ruby", "node", "nodejs", "deno", "bun", "php", "lua", "luajit",
    "tclsh", "awk", "gawk", "mawk", "nawk", "sed", "gsed", "crontab", "at", "batch", "trap", "alias",
    "powershell", "pwsh", "cmd", "cmd.exe", "-exec", "-execdir", "-ok", "-okdir",
    // Tools with their own escape to a shell: git aliases/pagers ("!cmd"), SQL clients (\\! cmd,
    // .shell cmd, system cmd), editors and debuggers (!cmd, shell cmd).
    "git", "mysql", "mariadb", "psql", "sqlite3", "vi", "vim", "nvim", "ex", "ed", "emacs", "gdb",
    "lldb",
];

/// Commands that run their arguments as another command line; a dynamic argument here (`sudo $x`)
/// may name any program, including a shell.
const WRAPPER_COMMANDS: &[&str] = &[
    "sudo", "doas", "env", "nohup", "timeout", "nice", "ionice", "stdbuf", "command", "builtin",
    "exec", "time", "chroot", "caffeinate", "unbuffer",
];

/// Variables whose value a shell or common tool later executes as a command.
const CODE_VARIABLES: &[&str] = &[
    "PROMPT_COMMAND", "PS0", "PS1", "PS2", "PS4", "BASH_ENV", "ENV", "EDITOR", "VISUAL", "PAGER",
    "GIT_SSH_COMMAND", "GIT_EDITOR", "GIT_PAGER", "LESSOPEN", "LESSCLOSE",
];

#[napi]
pub fn rehydrate(text: String, mapping_dict: HashMap<String, String>) -> Result<String> {
    Ok(rehydrate_text(&text, &mapping_dict))
}

/// Replaces placeholders with their values in a single left-to-right pass over the original text.
///
/// Inserted values are never scanned again, so a value that happens to contain another placeholder
/// stays literal, and the result does not depend on HashMap iteration order. A placeholder is only
/// restored when doing so keeps the Bash AST shape, and the combined result is checked once more.
fn rehydrate_text(text: &str, mapping: &HashMap<String, String>) -> String {
    if mapping.is_empty() || !text.contains('[') {
        return text.to_string();
    }

    // Longest token first so the leftmost-first alternation picks the longest match at a position;
    // the tie-break keeps the pattern deterministic.
    let mut tokens: Vec<&str> = mapping
        .keys()
        .map(String::as_str)
        .filter(|token| !token.is_empty() && text.contains(*token))
        .collect();
    if tokens.is_empty() {
        return text.to_string();
    }
    tokens.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    let pattern = tokens.iter().map(|token| regex::escape(token)).collect::<Vec<_>>().join("|");
    let Ok(matcher) = Regex::new(&pattern) else {
        return text.to_string();
    };
    let matches: Vec<(usize, usize)> = matcher.find_iter(text).map(|m| (m.start(), m.end())).collect();
    if matches.is_empty() {
        return text.to_string();
    }

    let splice = |pick: &dyn Fn(&str) -> String| -> String {
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for &(start, end) in &matches {
            out.push_str(&text[last..start]);
            out.push_str(&pick(&text[start..end]));
            last = end;
        }
        out.push_str(&text[last..]);
        out
    };

    let baseline = splice(&|_| NEUTRAL_WORD.to_string());
    let Some(baseline_shape) = bash_shape(&baseline) else {
        return text.to_string();
    };
    // Bash deletes a backslash-newline before splitting words, tree-sitter treats it as a separator:
    // `e\\<newline>val` parses as `e val` but runs as `eval`. Rather than re-lexing the shell, text
    // with line continuations gets the same strict treatment as a detected evaluator.
    // A parse with ERROR nodes means tree-sitter's view of the command may not be bash's either.
    let second_order = baseline.contains("\\\n")
        || parse_bash(&baseline).is_none_or(|tree| {
            tree.root_node().has_error() || has_second_order_evaluation(tree.root_node(), &baseline)
        });

    let mut present: Vec<&str> = matches.iter().map(|&(start, end)| &text[start..end]).collect();
    present.sort_unstable();
    present.dedup();

    let mut approved: Vec<&str> = Vec::new();
    for token in present {
        let value = &mapping[token];
        if second_order && !survives_reparsing(value) {
            continue;
        }
        let single = splice(&|t| if t == token { value.clone() } else { NEUTRAL_WORD.to_string() });
        if bash_shape(&single).as_ref() == Some(&baseline_shape) {
            approved.push(token);
        }
    }
    if approved.is_empty() {
        return text.to_string();
    }

    let result = splice(&|t| if approved.contains(&t) { mapping[t].clone() } else { t.to_string() });
    let combined_baseline = splice(&|t| if approved.contains(&t) { NEUTRAL_WORD.to_string() } else { t.to_string() });
    match (bash_shape(&combined_baseline), bash_shape(&result)) {
        (Some(before), Some(after)) if before == after => result,
        _ => text.to_string(),
    }
}

/// Whether a value stays a single, non-code word when a shell (or a tool's own escape syntax) parses
/// it again: no separators, redirections, substitutions, quotes, escapes, groups or whitespace, and
/// no leading `!` (git alias / ed / gdb shell escape), `#` (comment) or `-` (option injection).
/// `$name` alone only expands a variable and `*?[` only glob, so ordinary passwords such as
/// `P@ss!w0rd#` or `pa$$word` still pass.
fn survives_reparsing(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with(['!', '#', '-'])
        && value.chars().all(|c| !c.is_whitespace() && !c.is_control() && !";&|<>()`'\"\\{}".contains(c))
}

/// The word as the shell will see it, as far as naming a command goes (`e''val`, `\\eval`).
fn unquoted_word(raw: &str) -> String {
    raw.chars().filter(|c| !matches!(c, '\'' | '"' | '\\')).collect()
}

/// A word whose final text is only known at run time: parameter/command substitution, brace
/// expansion (`{eval,}`) or globbing (`/bin/s?`).
fn is_dynamic_word(word: &str) -> bool {
    word.contains(['$', '`', '{', '}', '*', '?', '['])
}

fn is_second_order_word(raw: &str) -> bool {
    let word = unquoted_word(raw);
    let name = word.rsplit('/').next().unwrap_or(&word);
    SECOND_ORDER_WORDS.contains(&name) || name.starts_with("python")
}

fn has_second_order_evaluation(node: Node<'_>, source: &str) -> bool {
    let text_of = |n: Node<'_>| n.utf8_text(source.as_bytes()).unwrap_or("");
    match node.kind() {
        "command" => {
            if let Some(name) = node.child_by_field_name("name") {
                let name_text = unquoted_word(text_of(name));
                // A command name built at runtime (`$cmd "[SECRET_1]"`) could be anything.
                if is_dynamic_word(&name_text) || is_second_order_word(&name_text) {
                    return true;
                }
                let base = name_text.rsplit('/').next().unwrap_or(&name_text).to_string();
                let is_wrapper = WRAPPER_COMMANDS.contains(&base.as_str());
                let mut cursor = node.walk();
                for argument in node.children_by_field_name("argument", &mut cursor) {
                    let arg = unquoted_word(text_of(argument));
                    if is_second_order_word(&arg) || (is_wrapper && is_dynamic_word(&arg)) {
                        return true;
                    }
                    // sudo -s / -i and doas -s run their arguments through a shell.
                    if (base == "sudo" || base == "doas")
                        && (arg == "--shell" || arg == "--login"
                            || (arg.starts_with('-') && !arg.starts_with("--") && (arg.contains('s') || arg.contains('i'))))
                    {
                        return true;
                    }
                }
            }
        }
        "variable_assignment" => {
            if let Some(name) = node.child_by_field_name("name") {
                if CODE_VARIABLES.contains(&text_of(name)) {
                    return true;
                }
            }
        }
        _ => {}
    }
    let mut cursor = node.walk();
    let children: Vec<Node<'_>> = node.children(&mut cursor).collect();
    children.into_iter().any(|child| has_second_order_evaluation(child, source))
}

fn append_shape(node: Node<'_>, field: Option<&str>, shape: &mut Vec<String>) {
    shape.push(format!(
        "{}|{}|{}|{}|{}|{}",
        field.unwrap_or(""),
        node.kind(),
        node.child_count(),
        node.is_named(),
        node.is_error(),
        node.is_missing()
    ));
    for index in 0..node.child_count() {
        if let Some(child) = node.child(index) {
            append_shape(child, node.field_name_for_child(index), shape);
        }
    }
}

fn parse_bash(text: &str) -> Option<tree_sitter::Tree> {
    let mut parser = Parser::new();
    parser.set_language(&tree_sitter_bash::LANGUAGE.into()).ok()?;
    parser.parse(text, None)
}

fn bash_shape(text: &str) -> Option<Vec<String>> {
    let tree = parse_bash(text)?;
    let mut shape = Vec::new();
    append_shape(tree.root_node(), None, &mut shape);
    Some(shape)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_prefixed_environment_token_reversibly() {
        let original = "export GITHUB_TOKEN=ghp_aBcDeF1234567890".to_string();
        let sanitized = sanitize(original.clone()).unwrap();
        assert_eq!(sanitized.clean_text, "export GITHUB_TOKEN=[SECRET_1]");
        assert_eq!(
            sanitized.mapping_dict.get("[SECRET_1]").unwrap(),
            "ghp_aBcDeF1234567890"
        );
        assert_eq!(
            rehydrate(sanitized.clean_text, sanitized.mapping_dict).unwrap(),
            original
        );
    }

    #[test]
    fn sanitizes_authorization_value_without_losing_scheme() {
        let original = "Authorization: Bearer abcdefghijklmnop".to_string();
        let sanitized = sanitize(original.clone()).unwrap();
        assert_eq!(sanitized.clean_text, "Authorization: Bearer [AUTH_1]");
        assert_eq!(
            rehydrate(sanitized.clean_text, sanitized.mapping_dict).unwrap(),
            original
        );
    }

    #[test]
    fn rehydrates_atomic_shell_values_when_shape_is_unchanged() {
        let mapping = HashMap::from([("[IP_1]".to_string(), "10.0.1.11".to_string())]);
        assert_eq!(
            rehydrate("ssh root@[IP_1]".to_string(), mapping).unwrap(),
            "ssh root@10.0.1.11"
        );
    }

    #[test]
    fn blocks_rehydration_that_adds_shell_syntax() {
        let mapping = HashMap::from([(
            "[SECRET_1]".to_string(),
            "safe; touch /tmp/getssh-pwned".to_string(),
        )]);
        assert_eq!(
            rehydrate("echo [SECRET_1]".to_string(), mapping).unwrap(),
            "echo [SECRET_1]"
        );
    }

    #[test]
    fn allows_shell_metacharacters_that_remain_quoted_data() {
        let mapping = HashMap::from([("[SECRET_1]".to_string(), "safe; still-data".to_string())]);
        assert_eq!(
            rehydrate("echo \"[SECRET_1]\"".to_string(), mapping).unwrap(),
            "echo \"safe; still-data\""
        );
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn inserted_values_are_never_rescanned_for_other_tokens() {
        for i in 0..50 {
            let a = format!("[SECRET_{}]", i);
            let b = format!("[SECRET_{}]", i + 1);
            let mapping = map(&[(&a, &format!("val_{}", b)), (&b, "EXPLOITED_SECOND_ORDER")]);
            let out = rehydrate(format!("echo \"{}\"", a), mapping).unwrap();
            assert_eq!(out, format!("echo \"val_{}\"", b));
        }
    }

    #[test]
    fn result_does_not_depend_on_map_iteration_order() {
        let text = "ssh [IP_1] && echo [IP_10] [IP_1]0".to_string();
        let expected = "ssh 10.0.0.1 && echo 10.0.0.10 10.0.0.10";
        for _ in 0..50 {
            let mapping = map(&[("[IP_1]", "10.0.0.1"), ("[IP_10]", "10.0.0.10")]);
            assert_eq!(rehydrate(text.clone(), mapping).unwrap(), expected);
        }
    }

    #[test]
    fn blocks_metacharacter_values_under_second_order_evaluators() {
        let payload = "echo safe; echo pwned";
        for text in [
            "eval \"[SECRET_1]\"",
            "bash -c \"[SECRET_1]\"",
            "sudo -u root sh -c '[SECRET_1]'",
            "echo \"[SECRET_1]\" | sh",
            "x=\"[SECRET_1]\"; eval \"$x\"",
            "ssh host \"echo [SECRET_1]\"",
            "find . -name x -exec echo \"[SECRET_1]\" \\;",
            "export PROMPT_COMMAND=\"[SECRET_1]\"",
            "sudo -s \"[SECRET_1]\"",
            "$runner \"[SECRET_1]\"",
            "/usr/bin/python3 -c \"[SECRET_1]\"",
            // Obfuscated evaluator names.
            "e\\\nval \"echo [SECRET_1]\"",
            "s\\\nh -c \"[SECRET_1]\"",
            "e''val \"[SECRET_1]\"",
            "{eval,} \"[SECRET_1]\"",
            "/bin/s? -c \"[SECRET_1]\"",
            "sudo $shell -c \"[SECRET_1]\"",
            "command eval \"[SECRET_1]\"",
            "f() { eval \"$1\"; }; f \"[SECRET_1]\"",
            // Tools with their own shell escape.
            "git -c alias.z='[SECRET_1]' z",
            "sqlite3 db \"[SECRET_1]\"",
            "mysql -e \"[SECRET_1]\"",
        ] {
            let out = rehydrate(text.to_string(), map(&[("[SECRET_1]", payload)])).unwrap();
            assert_eq!(out, text, "must stay a placeholder in: {}", text);
        }
    }

    #[test]
    fn keeps_inert_values_and_ordinary_commands_working() {
        assert_eq!(
            rehydrate("ssh root@[IP_1] 'uptime'".to_string(), map(&[("[IP_1]", "10.0.1.11")])).unwrap(),
            "ssh root@10.0.1.11 'uptime'"
        );
        assert_eq!(
            rehydrate("bash -c \"mysql -p[SECRET_1]\"".to_string(), map(&[("[SECRET_1]", "s3cr3t_Token-42")])).unwrap(),
            "bash -c \"mysql -ps3cr3t_Token-42\""
        );
        for (text, value, expected) in [
            ("mysql -u root -p'[SECRET_1]' -h [IP_1]", "P@ss!w0rd#", "mysql -u root -p'P@ss!w0rd#' -h 10.0.0.5"),
            ("ssh root@[IP_1] \"mysql -p'[SECRET_1]'\"", "P@ss!w0rd#", "ssh root@10.0.0.5 \"mysql -p'P@ss!w0rd#'\""),
            ("mysql -p'[SECRET_1]' -e 'show databases'", "pa$$word", "mysql -p'pa$$word' -e 'show databases'"),
            ("sshpass -p '[SECRET_1]' ssh root@[IP_1]", "P@ss!w0rd#", "sshpass -p 'P@ss!w0rd#' ssh root@10.0.0.5"),
            ("It's host [IP_1], password [SECRET_1].", "P@ss!w0rd#", "It's host 10.0.0.5, password P@ss!w0rd#."),
        ] {
            let mapping = map(&[("[IP_1]", "10.0.0.5"), ("[SECRET_1]", value)]);
            assert_eq!(rehydrate(text.to_string(), mapping).unwrap(), expected);
        }
        // Without a second-order evaluator, quoted metacharacters remain data (first-order AST check only).
        assert_eq!(
            rehydrate("echo \"[SECRET_1]\" | sudo -S apt update".to_string(), map(&[("[SECRET_1]", "p@ss;w0rd!")])).unwrap(),
            "echo \"p@ss;w0rd!\" | sudo -S apt update"
        );
    }

    #[test]
    fn blocks_tool_specific_shell_escapes() {
        for (text, value) in [
            ("git -c alias.z='[S]' z", "!reboot"),
            ("git -c alias.z='[S]' z", "!touch /tmp/pwn"),
            ("sqlite3 db \"[S]\"", ".shell reboot"),
            ("mysql -e \"[S]\"", "\\! reboot"),
            ("ssh h \"echo [S]\"", "a&reboot"),
            ("ssh h \"echo [S]\"", "a|sh"),
            ("ssh h \"ls [S]\"", "-oProxyCommand=reboot"),
        ] {
            let out = rehydrate(text.to_string(), map(&[("[S]", value)])).unwrap();
            assert_eq!(out, text, "{} with {:?}", text, value);
        }
    }

    #[test]
    fn line_continuations_only_admit_inert_values() {
        let text = "curl -X POST https://[IP_1]/api \\\n  -H \"Authorization: Bearer [AUTH_1]\" -d '[SECRET_1]'";
        let mapping = map(&[("[IP_1]", "10.0.0.5"), ("[AUTH_1]", "abc.def-123"), ("[SECRET_1]", "x'; rm -rf ~; echo '")]);
        assert_eq!(
            rehydrate(text.to_string(), mapping).unwrap(),
            "curl -X POST https://10.0.0.5/api \\\n  -H \"Authorization: Bearer abc.def-123\" -d '[SECRET_1]'"
        );
    }

    #[test]
    fn restores_safe_tokens_while_leaving_unsafe_ones() {
        let mapping = map(&[("[IP_1]", "10.0.0.1"), ("[SECRET_1]", "a; rm -rf ~")]);
        assert_eq!(
            rehydrate("ssh [IP_1] echo [SECRET_1]".to_string(), mapping).unwrap(),
            "ssh 10.0.0.1 echo [SECRET_1]"
        );
    }
}

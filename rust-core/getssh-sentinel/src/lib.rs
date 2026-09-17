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

#[napi]
pub fn rehydrate(text: String, mapping_dict: HashMap<String, String>) -> Result<String> {
    if !text.contains('[') {
        return Ok(text);
    }

    let mut result = text;
    for (token, val) in mapping_dict {
        if result.contains(&token) {
            let candidate = result.replace(&token, &val);
            if preserves_replacement_shape(&result, &token, &candidate) {
                result = candidate;
            }
        }
    }
    Ok(result)
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
            append_shape(child, node.field_name_for_child(index as u32), shape);
        }
    }
}

fn bash_shape(text: &str) -> Option<Vec<String>> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .ok()?;
    let tree = parser.parse(text, None)?;
    let mut shape = Vec::new();
    append_shape(tree.root_node(), None, &mut shape);
    Some(shape)
}

fn preserves_replacement_shape(before: &str, token: &str, after: &str) -> bool {
    if before == after {
        return true;
    }
    // Bracketed placeholders have Bash syntax of their own (`[ ... ]`). Compare
    // against a neutral word in the same positions so the placeholder notation
    // itself does not create a false shape mismatch.
    let baseline = before.replace(token, "GETSSH_REDACTED_VALUE");
    match (bash_shape(&baseline), bash_shape(after)) {
        (Some(before_shape), Some(after_shape)) => before_shape == after_shape,
        _ => false,
    }
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
}

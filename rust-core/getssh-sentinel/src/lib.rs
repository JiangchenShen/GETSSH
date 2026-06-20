use napi::bindgen_prelude::*;
use napi_derive::napi;
use regex::Regex;
use lazy_static::lazy_static;
use std::collections::HashMap;

lazy_static! {
    static ref IPV4_REGEX: Regex = Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap();
    static ref AWS_KEY_REGEX: Regex = Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap();
    static ref PRIVATE_KEY_REGEX: Regex = Regex::new(r"-----BEGIN (?:[A-Z ]+)PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]+?\s*-----END (?:[A-Z ]+)PRIVATE KEY-----").unwrap();
    static ref CREDENTIAL_REGEX: Regex = Regex::new(r"(?i)\b(password|passwd|db_pass|secret|token|api_key|authorization)(\s*[:=]\s*)([\x22\x27]?)([a-zA-Z0-9_\-+/=]{8,})([\x22\x27]?)").unwrap();
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
    let mut cred_count = 1;

    // IPv4
    let mut new_text = String::new();
    let mut last_match = 0;
    for caps in IPV4_REGEX.captures_iter(&clean_text) {
        let m = caps.get(0).unwrap();
        // ignore 127.0.0.1 or 0.0.0.0
        let val = m.as_str();
        if val == "127.0.0.1" || val == "0.0.0.0" { continue; }
        
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

    // Credentials (capture group 4 is the actual secret)
    new_text = String::new();
    last_match = 0;
    for caps in CREDENTIAL_REGEX.captures_iter(&clean_text) {
        let full_match = caps.get(0).unwrap();
        let secret = caps.get(4).unwrap();
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
            result = result.replace(&token, &val);
        }
    }
    Ok(result)
}

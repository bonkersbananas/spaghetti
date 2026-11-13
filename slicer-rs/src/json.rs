//! Just enough JSON to read OrcaSlicer's presets: objects, arrays, strings, numbers, booleans and null.

use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
}

impl Json {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }
}

/// The value in `text`, or None when it isn't JSON.
pub fn parse(text: &str) -> Option<Json> {
    let mut p = Parser { bytes: text.as_bytes(), at: 0 };
    let value = p.value()?;
    p.space();
    (p.at == p.bytes.len()).then_some(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn space(&mut self) {
        while self.at < self.bytes.len() && self.bytes[self.at].is_ascii_whitespace() {
            self.at += 1;
        }
    }

    fn eat(&mut self, b: u8) -> bool {
        self.space();
        if self.bytes.get(self.at) == Some(&b) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn word(&mut self, w: &str) -> bool {
        if self.bytes[self.at..].starts_with(w.as_bytes()) {
            self.at += w.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self) -> Option<Json> {
        self.space();
        match *self.bytes.get(self.at)? {
            b'{' => {
                self.at += 1;
                let mut out = BTreeMap::new();
                if self.eat(b'}') {
                    return Some(Json::Object(out));
                }
                loop {
                    self.space();
                    let key = self.string()?;
                    if !self.eat(b':') {
                        return None;
                    }
                    out.insert(key, self.value()?);
                    if self.eat(b'}') {
                        return Some(Json::Object(out));
                    }
                    if !self.eat(b',') {
                        return None;
                    }
                }
            }
            b'[' => {
                self.at += 1;
                let mut out = Vec::new();
                if self.eat(b']') {
                    return Some(Json::Array(out));
                }
                loop {
                    out.push(self.value()?);
                    if self.eat(b']') {
                        return Some(Json::Array(out));
                    }
                    if !self.eat(b',') {
                        return None;
                    }
                }
            }
            b'"' => self.string().map(Json::String),
            b't' => self.word("true").then_some(Json::Bool(true)),
            b'f' => self.word("false").then_some(Json::Bool(false)),
            b'n' => self.word("null").then_some(Json::Null),
            _ => {
                let start = self.at;
                while self.at < self.bytes.len()
                    && matches!(self.bytes[self.at], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                {
                    self.at += 1;
                }
                std::str::from_utf8(&self.bytes[start..self.at]).ok()?.parse().ok().map(Json::Number)
            }
        }
    }

    fn string(&mut self) -> Option<String> {
        if self.bytes.get(self.at) != Some(&b'"') {
            return None;
        }
        self.at += 1;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let b = *self.bytes.get(self.at)?;
            self.at += 1;
            match b {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let e = *self.bytes.get(self.at)?;
                    self.at += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let mut code = self.hex4()?;
                            // A surrogate pair is one character.
                            if (0xD800..0xDC00).contains(&code) && self.word("\\u") {
                                let low = self.hex4()?;
                                code = 0x10000 + ((code - 0xD800) << 10) + (low.checked_sub(0xDC00)?);
                            }
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(char::from_u32(code)?.encode_utf8(&mut buf).as_bytes());
                        }
                        other => out.push(other),
                    }
                }
                _ => out.push(b),
            }
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let digits = std::str::from_utf8(self.bytes.get(self.at..self.at + 4)?).ok()?;
        self.at += 4;
        u32::from_str_radix(digits, 16).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_presets_hold() {
        let j =
            parse(r#" {"a": "1", "b": ["x\n", "é\"q"], "c": [], "d": {"e": true, "f": null, "g": -2.5e1}} "#).unwrap();
        let Json::Object(o) = j else { panic!() };
        assert_eq!(o["a"], Json::String("1".into()));
        assert_eq!(o["b"], Json::Array(vec![Json::String("x\n".into()), Json::String("é\"q".into())]));
        assert_eq!(o["c"], Json::Array(vec![]));
        let Json::Object(d) = &o["d"] else { panic!() };
        assert_eq!(d["e"], Json::Bool(true));
        assert_eq!(d["f"], Json::Null);
        assert_eq!(d["g"], Json::Number(-25.0));
        assert!(parse("{\"a\": }").is_none());
        assert!(parse("[1, 2").is_none());
    }
}

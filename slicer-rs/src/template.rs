//! OrcaSlicer's G-code template language (its PlaceholderParser), as far as the X2D's start, end, layer change and
//! timelapse G-code use it: text with `[variable]` and `{expression}`, `{if …}{elsif …}{else}{endif}` blocks whose
//! text is kept as written (newlines and indentation too), and expressions with Orca's types and rules: integer
//! arithmetic stays integer, numbers compare within 1e-8, a string on either side compares as text, and a decimal
//! prints as C++'s default stream does (six significant digits, no trailing zeros).
//!
//! Anything else in Orca's language (variables of one's own, regular expressions, `one_of` and the like) is an
//! error here rather than a guess.

use std::collections::HashMap;

/// A value while evaluating, as Orca's `expr`.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// The value of anything in a branch that is skipped.
    Empty,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
}

/// A variable: one value, or one per filament or nozzle.
#[derive(Clone, Debug, PartialEq)]
pub enum Var {
    Scalar(Value),
    Vector(Vec<Value>),
}

/// Variables by name.
#[derive(Clone, Debug, Default)]
pub struct Vars(pub HashMap<String, Var>);

impl Vars {
    pub fn set(&mut self, name: &str, var: Var) -> &mut Self {
        self.0.insert(name.to_string(), var);
        self
    }
    pub fn int(&mut self, name: &str, v: i64) -> &mut Self {
        self.set(name, Var::Scalar(Value::Int(v)))
    }
    pub fn float(&mut self, name: &str, v: f64) -> &mut Self {
        self.set(name, Var::Scalar(Value::Float(v)))
    }
    pub fn bool(&mut self, name: &str, v: bool) -> &mut Self {
        self.set(name, Var::Scalar(Value::Bool(v)))
    }
    pub fn str(&mut self, name: &str, v: &str) -> &mut Self {
        self.set(name, Var::Scalar(Value::Str(v.to_string())))
    }
    pub fn ints(&mut self, name: &str, v: &[i64]) -> &mut Self {
        self.set(name, Var::Vector(v.iter().map(|&i| Value::Int(i)).collect()))
    }
    pub fn floats(&mut self, name: &str, v: &[f64]) -> &mut Self {
        self.set(name, Var::Vector(v.iter().map(|&f| Value::Float(f)).collect()))
    }
    pub fn strs(&mut self, name: &str, v: &[&str]) -> &mut Self {
        self.set(name, Var::Vector(v.iter().map(|s| Value::Str(s.to_string())).collect()))
    }
}

/// Fills `template` from `scopes` (searched first to last, as Orca's per-call config before its parser's own
/// variables before the print's settings). `extruder` is the filament a vector without an index stands for.
pub fn process(template: &str, scopes: &[&Vars], extruder: usize) -> Result<String, String> {
    let mut p = Parser { s: template.as_bytes(), at: 0, scopes, extruder };
    let mut out = String::new();
    p.text_block(&mut out, true)?;
    if p.at < p.s.len() {
        return Err(p.error("unexpected {elsif}, {else} or {endif}"));
    }
    Ok(out)
}

impl Value {
    /// As Orca writes an expression's value into G-code.
    pub fn to_text(&self) -> String {
        match self {
            Value::Empty => String::new(),
            Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
            Value::Int(i) => i.to_string(),
            Value::Float(f) => format_g(*f),
            Value::Str(s) => s.clone(),
        }
    }

    fn as_f(&self) -> f64 {
        match self {
            Value::Int(i) => *i as f64,
            Value::Float(f) => *f,
            _ => f64::NAN,
        }
    }

    fn numeric(&self) -> bool {
        matches!(self, Value::Int(_) | Value::Float(_))
    }
}

/// A decimal as C++'s `std::ostream << double` writes it with its default precision of 6: `%g`.
pub fn format_g(v: f64) -> String {
    if v == 0.0 {
        return if v.is_sign_negative() { "-0".into() } else { "0".into() };
    }
    if !v.is_finite() {
        return if v.is_nan() { "nan".into() } else if v > 0.0 { "inf".into() } else { "-inf".into() };
    }
    // Six significant digits, rounded as printf rounds (to the nearest, from the exact binary value).
    let sci = format!("{:.5e}", v);
    let (mantissa, exp) = sci.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    if !(-4..6).contains(&exp) {
        let m = trim_zeros(mantissa);
        let sign = if exp < 0 { '-' } else { '+' };
        return format!("{m}e{sign}{:02}", exp.abs());
    }
    let decimals = (5 - exp).max(0) as usize;
    trim_zeros(&format!("{:.*}", decimals, v)).to_string()
}

fn trim_zeros(s: &str) -> &str {
    if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.') } else { s }
}

/// A legacy `[variable]`: written as Orca's config serializes it.
fn serialize(v: &Value) -> String {
    match v {
        Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        other => other.to_text(),
    }
}

struct Parser<'a> {
    s: &'a [u8],
    at: usize,
    scopes: &'a [&'a Vars],
    extruder: usize,
}

const KEYWORDS: [&str; 7] = ["if", "elsif", "else", "endif", "and", "or", "not"];

impl Parser<'_> {
    fn error(&self, what: &str) -> String {
        let line = self.s[..self.at.min(self.s.len())].iter().filter(|&&b| b == b'\n').count() + 1;
        format!("template line {line}: {what}")
    }

    fn peek(&self) -> Option<u8> {
        self.s.get(self.at).copied()
    }

    fn space(&mut self) {
        while self.peek().is_some_and(|b| b.is_ascii_whitespace()) {
            self.at += 1;
        }
    }

    fn eat(&mut self, token: &str) -> bool {
        self.space();
        if self.s[self.at..].starts_with(token.as_bytes()) {
            self.at += token.len();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, token: &str) -> Result<(), String> {
        if self.eat(token) { Ok(()) } else { Err(self.error(&format!("expected {token}"))) }
    }

    /// The next word, if it is `word` (and not the start of a longer name).
    fn keyword(&mut self, word: &str) -> bool {
        self.space();
        let end = self.at + word.len();
        if self.s[self.at..].starts_with(word.as_bytes())
            && !self.s.get(end).is_some_and(|&b| b.is_ascii_alphanumeric() || b == b'_')
        {
            self.at = end;
            true
        } else {
            false
        }
    }

    fn identifier(&mut self) -> Option<String> {
        self.space();
        let start = self.at;
        if !self.peek().is_some_and(|b| b.is_ascii_alphabetic() || b == b'_') {
            return None;
        }
        while self.peek().is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_') {
            self.at += 1;
        }
        let word = std::str::from_utf8(&self.s[start..self.at]).unwrap().to_string();
        if KEYWORDS.contains(&word.as_str()) {
            self.at = start;
            return None;
        }
        Some(word)
    }

    fn lookup(&self, name: &str) -> Option<&Var> {
        self.scopes.iter().find_map(|v| v.0.get(name))
    }

    /// Text and macros up to the end, or up to a `{elsif`, `{else}` or `{endif}` (left for the `{if}` it belongs to).
    fn text_block(&mut self, out: &mut String, active: bool) -> Result<(), String> {
        while let Some(b) = self.peek() {
            match b {
                b'[' => {
                    self.at += 1;
                    let text = self.legacy(active)?;
                    self.expect("]")?;
                    out.push_str(&text);
                }
                b'{' => {
                    let open = self.at;
                    self.at += 1;
                    if self.keyword("elsif") || self.keyword("else") || self.keyword("endif") {
                        self.at = open;
                        return Ok(());
                    }
                    if self.eat("}") {
                        continue;
                    }
                    if self.keyword("if") {
                        self.if_block(out, active)?;
                    } else {
                        let v = self.conditional(active)?;
                        if active {
                            out.push_str(&v.to_text());
                        }
                    }
                    self.expect("}")?;
                }
                _ => {
                    let start = self.at;
                    while self.peek().is_some_and(|b| b != b'[' && b != b'{') {
                        self.at += 1;
                    }
                    if active {
                        out.push_str(std::str::from_utf8(&self.s[start..self.at]).map_err(|_| self.error("not UTF-8"))?);
                    }
                }
            }
        }
        Ok(())
    }

    /// After `{if`: the condition, the branches, up to (not including) the `}` of `{endif}`.
    fn if_block(&mut self, out: &mut String, active: bool) -> Result<(), String> {
        let cond = self.boolean(active)?;
        self.expect("}")?;
        let mut taken = active && cond;
        self.text_block(out, taken)?;
        loop {
            self.expect("{")?;
            if self.keyword("elsif") {
                let c = self.boolean(active && !taken)?;
                self.expect("}")?;
                let branch = active && !taken && c;
                self.text_block(out, branch)?;
                taken |= branch;
            } else if self.keyword("else") {
                self.expect("}")?;
                self.text_block(out, active && !taken)?;
                self.expect("{")?;
                if !self.keyword("endif") {
                    return Err(self.error("expected {endif}"));
                }
                return Ok(());
            } else if self.keyword("endif") {
                return Ok(());
            } else {
                return Err(self.error("expected {elsif}, {else} or {endif}"));
            }
        }
    }

    /// `[name]`, `[name_3]` or `[name[index_variable]]`, written as the config writes it (nothing in a skipped
    /// branch).
    fn legacy(&mut self, active: bool) -> Result<String, String> {
        let name = self.identifier().ok_or_else(|| self.error("expected a variable after ["))?;
        if self.eat("[") {
            let index_name = self.identifier().ok_or_else(|| self.error("expected an index variable"))?;
            self.expect("]")?;
            if !active {
                return Ok(String::new());
            }
            let index = match self.lookup(&index_name) {
                Some(Var::Scalar(Value::Int(i))) => *i,
                _ => return Err(self.error(&format!("{index_name} is not an integer variable"))),
            };
            let key = if self.lookup(&name).is_none() { name.trim_end_matches('_') } else { name.as_str() };
            return match self.lookup(key) {
                Some(Var::Vector(v)) if !v.is_empty() && index >= 0 => {
                    Ok(serialize(&v[if (index as usize) < v.len() { index as usize } else { 0 }]))
                }
                _ => Err(self.error(&format!("{name} is not a vector"))),
            };
        }
        if !active {
            return Ok(String::new());
        }
        match self.lookup(&name) {
            Some(Var::Scalar(v)) => Ok(serialize(v)),
            Some(Var::Vector(v)) if !v.is_empty() => {
                Ok(serialize(&v[if self.extruder < v.len() { self.extruder } else { 0 }]))
            }
            Some(Var::Vector(_)) => Err(self.error(&format!("{name} is empty"))),
            None => {
                // `name_3`: element 3 of the vector `name`.
                let (base, index) = name.rsplit_once('_').ok_or_else(|| self.error(&format!("no variable {name}")))?;
                let index: usize = index.parse().map_err(|_| self.error(&format!("no variable {name}")))?;
                match self.lookup(base) {
                    Some(Var::Vector(v)) if !v.is_empty() => Ok(serialize(&v[if index < v.len() { index } else { 0 }])),
                    _ => Err(self.error(&format!("no variable {name}"))),
                }
            }
        }
    }

    fn boolean(&mut self, active: bool) -> Result<bool, String> {
        match self.conditional(active)? {
            Value::Bool(b) => Ok(b),
            Value::Empty => Ok(false),
            other => Err(self.error(&format!("not a boolean: {other:?}"))),
        }
    }

    fn conditional(&mut self, active: bool) -> Result<Value, String> {
        let cond = self.logical_or(active)?;
        if !self.eat("?") {
            return Ok(cond);
        }
        let c = match cond {
            Value::Bool(b) => b,
            Value::Empty => false,
            other => return Err(self.error(&format!("not a boolean: {other:?}"))),
        };
        let a = self.conditional(active && c)?;
        self.expect(":")?;
        let b = self.conditional(active && !c)?;
        Ok(if !active { Value::Empty } else if c { a } else { b })
    }

    fn logical_or(&mut self, active: bool) -> Result<Value, String> {
        let mut v = self.logical_and(active)?;
        while self.keyword("or") || self.eat("||") {
            let rhs = self.logical_and(active)?;
            v = self.logic(v, rhs, |a, b| a || b)?;
        }
        Ok(v)
    }

    fn logical_and(&mut self, active: bool) -> Result<Value, String> {
        let mut v = self.equality(active)?;
        while self.keyword("and") || self.eat("&&") {
            let rhs = self.equality(active)?;
            v = self.logic(v, rhs, |a, b| a && b)?;
        }
        Ok(v)
    }

    fn logic(&self, a: Value, b: Value, f: fn(bool, bool) -> bool) -> Result<Value, String> {
        match (a, b) {
            (Value::Empty, _) | (_, Value::Empty) => Ok(Value::Empty),
            (Value::Bool(x), Value::Bool(y)) => Ok(Value::Bool(f(x, y))),
            (x, y) => Err(self.error(&format!("not booleans: {x:?}, {y:?}"))),
        }
    }

    fn equality(&mut self, active: bool) -> Result<Value, String> {
        let mut v = self.relational(active)?;
        loop {
            let invert = if self.eat("==") {
                false
            } else if self.eat("!=") || self.eat("<>") {
                true
            } else {
                return Ok(v);
            };
            let rhs = self.relational(active)?;
            v = self.compare(v, rhs, '=', invert)?;
        }
    }

    fn relational(&mut self, active: bool) -> Result<Value, String> {
        let mut v = self.additive(active)?;
        loop {
            // As Orca: a <= b is not (a > b), a >= b is not (a < b).
            let (op, invert) = if self.eat("<=") {
                ('>', true)
            } else if self.eat(">=") {
                ('<', true)
            } else if self.eat("<") {
                ('<', false)
            } else if self.eat(">") {
                ('>', false)
            } else {
                return Ok(v);
            };
            let rhs = self.additive(active)?;
            v = self.compare(v, rhs, op, invert)?;
        }
    }

    fn compare(&self, a: Value, b: Value, op: char, invert: bool) -> Result<Value, String> {
        if a == Value::Empty || b == Value::Empty {
            return Ok(Value::Empty);
        }
        let result = if a.numeric() && b.numeric() {
            match (&a, &b, op) {
                (Value::Int(x), Value::Int(y), '=') => x == y,
                (Value::Int(x), Value::Int(y), '<') => x < y,
                (Value::Int(x), Value::Int(y), _) => x > y,
                (_, _, '=') => (a.as_f() - b.as_f()).abs() < 1e-8,
                (_, _, '<') => a.as_f() < b.as_f(),
                _ => a.as_f() > b.as_f(),
            }
        } else if let (Value::Bool(x), Value::Bool(y)) = (&a, &b) {
            if op != '=' {
                return Err(self.error("booleans only compare for equality"));
            }
            x == y
        } else if matches!(a, Value::Str(_)) || matches!(b, Value::Str(_)) {
            let (x, y) = (a.to_text(), b.to_text());
            match op {
                '=' => x == y,
                '<' => x < y,
                _ => x > y,
            }
        } else {
            return Err(self.error(&format!("cannot compare {a:?} with {b:?}")));
        };
        Ok(Value::Bool(result != invert))
    }

    fn additive(&mut self, active: bool) -> Result<Value, String> {
        let mut v = self.multiplicative(active)?;
        loop {
            let op = if self.eat("+") {
                '+'
            } else if self.peek_minus() {
                '-'
            } else {
                return Ok(v);
            };
            let rhs = self.multiplicative(active)?;
            v = self.arithmetic(v, rhs, op)?;
        }
    }

    /// A binary minus (not the start of `-=` or anything else).
    fn peek_minus(&mut self) -> bool {
        self.eat("-")
    }

    fn multiplicative(&mut self, active: bool) -> Result<Value, String> {
        let mut v = self.unary(active)?;
        loop {
            let op = if self.eat("*") {
                '*'
            } else if self.eat("/") {
                '/'
            } else if self.eat("%") {
                '%'
            } else {
                return Ok(v);
            };
            let rhs = self.unary(active)?;
            v = self.arithmetic(v, rhs, op)?;
        }
    }

    fn arithmetic(&self, a: Value, b: Value, op: char) -> Result<Value, String> {
        if a == Value::Empty || b == Value::Empty {
            return Ok(Value::Empty);
        }
        if op == '+' {
            // Orca's + joins text when either side is text.
            if matches!(a, Value::Str(_)) || matches!(b, Value::Str(_)) {
                return Ok(Value::Str(a.to_text() + &b.to_text()));
            }
        }
        if !a.numeric() || !b.numeric() {
            return Err(self.error(&format!("not numbers: {a:?} {op} {b:?}")));
        }
        if let (Value::Int(x), Value::Int(y)) = (&a, &b) {
            return Ok(Value::Int(match op {
                '+' => x + y,
                '-' => x - y,
                '*' => x * y,
                '/' | '%' if *y == 0 => return Err(self.error("division by zero")),
                '/' => x / y,
                _ => x % y,
            }));
        }
        let (x, y) = (a.as_f(), b.as_f());
        Ok(Value::Float(match op {
            '+' => x + y,
            '-' => x - y,
            '*' => x * y,
            '/' | '%' if y == 0.0 => return Err(self.error("division by zero")),
            '/' => x / y,
            _ => x % y,
        }))
    }

    fn unary(&mut self, active: bool) -> Result<Value, String> {
        self.space();
        if self.eat("(") {
            let v = self.conditional(active)?;
            self.expect(")")?;
            return Ok(v);
        }
        if self.eat("-") {
            return Ok(match self.unary(active)? {
                Value::Int(i) => Value::Int(-i),
                Value::Float(f) => Value::Float(-f),
                Value::Empty => Value::Empty,
                other => return Err(self.error(&format!("cannot negate {other:?}"))),
            });
        }
        if self.eat("+") {
            return self.unary(active);
        }
        if self.keyword("not") || self.eat("!") {
            return Ok(match self.unary(active)? {
                Value::Bool(b) => Value::Bool(!b),
                Value::Empty => Value::Empty,
                other => return Err(self.error(&format!("not a boolean: {other:?}"))),
            });
        }
        if self.peek() == Some(b'"') {
            self.at += 1;
            let mut text = Vec::new();
            loop {
                match self.peek() {
                    None => return Err(self.error("unterminated string")),
                    Some(b'"') => {
                        self.at += 1;
                        break;
                    }
                    Some(b'\\') => {
                        self.at += 1;
                        text.push(self.peek().ok_or_else(|| self.error("unterminated string"))?);
                        self.at += 1;
                    }
                    Some(b) => {
                        text.push(b);
                        self.at += 1;
                    }
                }
            }
            let text = String::from_utf8(text).map_err(|_| self.error("not UTF-8"))?;
            return Ok(if active { Value::Str(text) } else { Value::Empty });
        }
        if self.peek().is_some_and(|b| b.is_ascii_digit() || b == b'.') {
            return self.number(active);
        }
        let start = self.at;
        let Some(name) = self.identifier() else { return Err(self.error("expected a value")) };
        match name.as_str() {
            "true" | "false" => return Ok(if active { Value::Bool(name == "true") } else { Value::Empty }),
            "min" | "max" => {
                self.expect("(")?;
                let a = self.conditional(active)?;
                self.expect(",")?;
                let b = self.conditional(active)?;
                self.expect(")")?;
                if !active {
                    return Ok(Value::Empty);
                }
                let pick_a = if name == "min" { a.as_f() <= b.as_f() } else { a.as_f() >= b.as_f() };
                return Ok(match (&a, &b) {
                    (Value::Int(_), Value::Int(_)) => if pick_a { a } else { b },
                    _ if a.numeric() && b.numeric() => Value::Float(if pick_a { a.as_f() } else { b.as_f() }),
                    _ => return Err(self.error("min and max take numbers")),
                });
            }
            "int" | "round" | "ceil" | "floor" => {
                self.expect("(")?;
                let a = self.conditional(active)?;
                self.expect(")")?;
                return Ok(match a {
                    Value::Empty => Value::Empty,
                    Value::Int(i) => Value::Int(i),
                    Value::Float(f) => Value::Int(match name.as_str() {
                        "int" => f.trunc(),
                        "round" => f.round(),
                        "ceil" => f.ceil(),
                        _ => f.floor(),
                    } as i64),
                    other => return Err(self.error(&format!("{name}() takes a number, not {other:?}"))),
                });
            }
            _ => {}
        }
        if self.peek_after_space() == Some(b'(') {
            self.at = start;
            return Err(self.error(&format!("unsupported function {name}()")));
        }
        // A variable, maybe indexed.
        let index = if self.eat("[") {
            let i = self.additive(active)?;
            self.expect("]")?;
            Some(i)
        } else {
            None
        };
        if !active {
            return Ok(Value::Empty);
        }
        let var = self.lookup(&name).ok_or_else(|| self.error(&format!("no variable {name}")))?;
        Ok(match (var, index) {
            // Orca ignores an index on a scalar, as Bambu Studio does.
            (Var::Scalar(v), _) => v.clone(),
            (Var::Vector(v), Some(i)) => {
                let i = match i {
                    Value::Int(i) => i,
                    Value::Float(f) => f as i64,
                    other => return Err(self.error(&format!("index is not a number: {other:?}"))),
                };
                if v.is_empty() {
                    return Err(self.error(&format!("{name} is empty")));
                }
                // Out of range is the first element, as Orca.
                v[if i >= 0 && (i as usize) < v.len() { i as usize } else { 0 }].clone()
            }
            (Var::Vector(v), None) => match v.get(if self.extruder < v.len() { self.extruder } else { 0 }) {
                Some(Value::Float(f)) => Value::Float(*f),
                _ => return Err(self.error(&format!("{name} needs an index"))),
            },
        })
    }

    fn peek_after_space(&mut self) -> Option<u8> {
        let at = self.at;
        self.space();
        let b = self.peek();
        self.at = at;
        b
    }

    /// A number: decimal when it has a point or an exponent, else an integer.
    fn number(&mut self, active: bool) -> Result<Value, String> {
        let start = self.at;
        while self.peek().is_some_and(|b| b.is_ascii_digit()) {
            self.at += 1;
        }
        let mut decimal = false;
        if self.peek() == Some(b'.') {
            decimal = true;
            self.at += 1;
            while self.peek().is_some_and(|b| b.is_ascii_digit()) {
                self.at += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E'))
            && (self.s.get(self.at + 1).is_some_and(|b| b.is_ascii_digit())
                || (matches!(self.s.get(self.at + 1), Some(b'+' | b'-'))
                    && self.s.get(self.at + 2).is_some_and(|b| b.is_ascii_digit())))
        {
            decimal = true;
            self.at += 2;
            while self.peek().is_some_and(|b| b.is_ascii_digit()) {
                self.at += 1;
            }
        }
        let text = std::str::from_utf8(&self.s[start..self.at]).unwrap();
        if !active {
            return Ok(Value::Empty);
        }
        if decimal {
            text.parse().map(Value::Float).map_err(|_| self.error(&format!("not a number: {text}")))
        } else {
            text.parse().map(Value::Int).map_err(|_| self.error(&format!("not a number: {text}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> Vars {
        let mut v = Vars::default();
        v.int("bed", 55)
            .float("max_layer_z", 48.0)
            .ints("nozzle_temperature_initial_layer", &[220])
            .floats("flush_volumetric_speeds", &[21.0])
            .strs("filament_type", &["PLA"])
            .str("curr_bed_type", "Textured PEI Plate")
            .str("timelapse_type", "0")
            .bool("spiral_mode", false)
            .int("initial_no_support_filament_id", 0)
            .int("initial_no_support_hotend", -1)
            .ints("first_non_support_filaments", &[0, -1])
            .ints("first_filaments", &[0, -1])
            .floats("first_x_layer_fan_speed", &[40.0])
            .ints("close_additional_fan_first_x_layers", &[3])
            .int("layer_num", 1);
        v
    }

    fn fill(t: &str) -> String {
        process(t, &[&vars()], 0).unwrap()
    }

    #[test]
    fn numbers_print_as_cpp_streams_do() {
        assert_eq!(format_g(104.0), "104");
        assert_eq!(format_g(48.4), "48.4");
        assert_eq!(format_g(21.0 / 2.4053 * 60.0), "523.843");
        assert_eq!(format_g(21.0 / 2.0 / 2.4053), "4.36536");
        assert_eq!(format_g(63.67781), "63.6778");
        assert_eq!(format_g(-0.003), "-0.003");
        assert_eq!(format_g(0.7), "0.7");
        assert_eq!(format_g(1234567.0), "1.23457e+06");
        assert_eq!(format_g(0.00001234), "1.234e-05");
        assert_eq!(format_g(0.0001234), "0.0001234");
        assert_eq!(format_g(999999.5), "1e+06");
    }

    #[test]
    fn fills_variables_and_expressions_as_orca() {
        assert_eq!(fill("M140 S[bed] ; heat"), "M140 S55 ; heat");
        assert_eq!(fill("M104 S{nozzle_temperature_initial_layer[initial_no_support_filament_id]-40} A"), "M104 S180 A");
        assert_eq!(fill("F{flush_volumetric_speeds[0]/2.4053*60}"), "F523.843");
        assert_eq!(fill("G29.1 Z{+0.0} ; x"), "G29.1 Z0 ; x");
        assert_eq!(fill("G29.1 Z{-0.003}"), "G29.1 Z-0.003");
        assert_eq!(fill("M620 D[initial_no_support_hotend]"), "M620 D-1");
        assert_eq!(fill("G1 Z{max_layer_z + 80.0 - max_layer_z/2} F600"), "G1 Z104 F600");
        assert_eq!(fill("S{first_x_layer_fan_speed[0]*255.0/100.0}"), "S102");
        assert_eq!(fill("L{(first_non_support_filaments[1] != -1 ? first_non_support_filaments[1] : (first_filaments[1] != -1 ? first_filaments[1] : 0))}"), "L0");
        assert_eq!(fill("M9711 M{timelapse_type}"), "M9711 M0");
        assert_eq!(fill("{7/2} {7.0/2} {7%3}"), "3 3.5 1");
        assert_eq!(fill("{max(3, 1)} {min(2.5, 4)}"), "3 2.5");
    }

    #[test]
    fn keeps_the_text_of_blocks_as_written() {
        let t = "a\n{if (max_layer_z + 4.0) < 256}\n    {if spiral_mode}\n      x\n    {else}\n      y\n    {endif}\n{else}\n  z\n{endif}\nb";
        assert_eq!(fill(t), "a\n\n    \n      y\n    \n\nb");
        let t = "{if curr_bed_type==\"Textured PEI Plate\"}T{elsif bed > 70}H{else}E{endif}";
        assert_eq!(fill(t), "T");
        let t = "{if (layer_num + 1 <= close_additional_fan_first_x_layers[0])}A{elsif (layer_num < 0)}B{endif}|";
        assert_eq!(fill(t), "A|");
        let t = "{if (filament_type[0] == \"PLA\") ||\n (filament_type[0] == \"PETG\")}yes{endif}";
        assert_eq!(fill(t), "yes");
        assert_eq!(fill("{if !spiral_mode && !(timelapse_type == 1) }ok{endif}"), "ok");
    }

    #[test]
    fn a_skipped_branch_does_not_need_its_variables() {
        assert_eq!(fill("{if false}{nothing_here[2]} [nor_this]{else}fine{endif}"), "fine");
    }

    #[test]
    fn what_it_does_not_know_is_an_error() {
        assert!(process("{missing}", &[&vars()], 0).is_err());
        assert!(process("{if bed}x{endif}", &[&vars()], 0).is_err());
        assert!(process("{one_of(bed, 1, 2)}", &[&vars()], 0).is_err());
        assert!(process("{if true}x", &[&vars()], 0).is_err());
        assert!(process("x{endif}", &[&vars()], 0).is_err());
    }
}

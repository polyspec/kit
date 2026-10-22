//! The Rust half of the check that no error is swallowed in silence (K537): an `Err(..)` arm of a match, or an `if let Err(..)`
//! branch without an else, whose body holds no statement. Each finding is printed as `file:line: message`; the exit status is 1
//! when there is one, and 2 when a file cannot be read or parsed.

use syn::spanned::Spanned;
use syn::visit::Visit;

/// The findings of one file.
struct Finder<'a> {
    file: &'a str,
    found: Vec<String>,
}

/// Whether `pattern` is `Err(..)`, the arm or branch of every error.
fn is_err_pattern(pattern: &syn::Pat) -> bool {
    matches!(pattern, syn::Pat::TupleStruct(tuple) if tuple.path.segments.last().is_some_and(|segment| segment.ident == "Err"))
}

/// Whether `expr` holds no statement: an empty block or the unit value.
fn is_empty(expr: &syn::Expr) -> bool {
    match expr {
        syn::Expr::Block(block) => block.block.stmts.is_empty(),
        syn::Expr::Tuple(tuple) => tuple.elems.is_empty(),
        _ => false,
    }
}

impl Finder<'_> {
    fn report(&mut self, line: usize) {
        self.found.push(format!(
            "{}:{line}: an Err branch holds no statement, so it swallows every error; name the outcome, or match the error and return the rest (K537)",
            self.file
        ));
    }
}

impl<'ast> Visit<'ast> for Finder<'_> {
    fn visit_arm(&mut self, arm: &'ast syn::Arm) {
        if is_err_pattern(&arm.pat) && is_empty(&arm.body) {
            self.report(arm.pat.span().start().line);
        }
        syn::visit::visit_arm(self, arm);
    }

    fn visit_expr_if(&mut self, node: &'ast syn::ExprIf) {
        if let syn::Expr::Let(binding) = &*node.cond
            && is_err_pattern(&binding.pat)
            && node.then_branch.stmts.is_empty()
            && node.else_branch.is_none()
        {
            self.report(binding.pat.span().start().line);
        }
        syn::visit::visit_expr_if(self, node);
    }
}

fn main() -> std::process::ExitCode {
    let mut found = Vec::new();
    for file in std::env::args().skip(1) {
        let tree = match std::fs::read_to_string(&file).map_err(|error| error.to_string()).and_then(|text| syn::parse_file(&text).map_err(|error| error.to_string())) {
            Ok(tree) => tree,
            Err(error) => {
                eprintln!("{file}: {error}");
                return std::process::ExitCode::from(2);
            }
        };
        let mut finder = Finder { file: &file, found: Vec::new() };
        finder.visit_file(&tree);
        found.append(&mut finder.found);
    }
    for finding in &found {
        eprintln!("{finding}");
    }
    if found.is_empty() { std::process::ExitCode::SUCCESS } else { std::process::ExitCode::FAILURE }
}

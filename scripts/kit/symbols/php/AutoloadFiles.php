<?php

// The check of the autoload files of lint-php (K377), read with nikic/php-parser beside the visitor of extract.php.

declare(strict_types=1);

namespace Polyspec\Kit\Symbols;

use PhpParser\Error;
use PhpParser\Node;
use PhpParser\NodeFinder;
use PhpParser\ParserFactory;

/**
 * The statements that an autoload file of a Composer package may hold (S2): declarations of namespaced functions and
 * constants, with declare(strict_types=1), the namespace declaration, use imports and define() of a namespaced constant
 * name, and the polyfill guard of such a declaration (K873). A require or include, another statement, a class,
 * interface, trait or enum, and a function or constant outside a namespace are findings, and so is a file that does not
 * parse.
 */
final class AutoloadFiles
{
    private const SHAPE = 'an autoload file holds only declarations of namespaced functions and constants (K377)';

    /** Prints a finding for each statement of `$files` that is not allowed, and returns the number of findings. */
    public static function check(array $files): int
    {
        $parser = (new ParserFactory())->createForNewestSupportedVersion();
        $findings = 0;
        foreach ($files as $file) {
            if (!is_file($file)) {
                self::finding($file, 1, 'the file does not exist; ' . self::SHAPE, $findings);
                continue;
            }
            try {
                $tree = $parser->parse((string) file_get_contents($file)) ?? [];
            } catch (Error $error) {
                $message = 'the file does not parse: ' . $error->getMessage();
                self::finding($file, $error->getStartLine(), $message, $findings);
                continue;
            }
            self::statements($tree, null, $file, $findings);
        }
        return $findings;
    }

    /**
     * Prints `file:line` for each polyfill guard of `$sources`, a map of a file name to its text (K883): the one
     * definition of the shape (isPolyfillGuard), which divergence-check asks for the guard lines that it leaves out.
     * A text that does not parse holds none.
     */
    public static function guards(array $sources): void
    {
        $parser = (new ParserFactory())->createForNewestSupportedVersion();
        foreach ($sources as $file => $text) {
            try {
                $tree = $parser->parse((string) $text) ?? [];
            } catch (Error) {
                continue;
            }
            foreach (self::guardLines($tree, null) as $line) {
                echo "{$file}:{$line}\n";
            }
        }
    }

    /** The lines of the conditions of the polyfill guards among `$statements` of the namespace `$namespace`. */
    private static function guardLines(array $statements, ?string $namespace): array
    {
        $lines = [];
        foreach ($statements as $statement) {
            if ($statement instanceof Node\Stmt\Namespace_) {
                if ($statement->stmts === null) {
                    $namespace = $statement->name?->toString();
                } else {
                    $lines = [...$lines, ...self::guardLines($statement->stmts, $statement->name?->toString())];
                }
            } elseif ($statement instanceof Node\Stmt\If_ && $namespace !== null) {
                if (self::isPolyfillGuard($statement, $namespace)) {
                    $lines[] = $statement->cond->getStartLine();
                }
            }
        }
        return $lines;
    }

    /** Prints a finding for `$file` at `$line` and counts it in `$findings`. */
    private static function finding(string $file, int $line, string $message, int &$findings): void
    {
        echo "{$file}:{$line}: {$message}\n";
        $findings++;
    }

    /** Checks the statements of one scope; `$namespace` is its namespace name, null in the global one. */
    private static function statements(array $statements, ?string $namespace, string $file, int &$findings): void
    {
        foreach ($statements as $statement) {
            // A namespace declaration without braces holds the statements after it as siblings: it is namespaced.
            if ($statement instanceof Node\Stmt\Namespace_) {
                if ($statement->stmts === null) {
                    $namespace = $statement->name?->toString();
                } else {
                    self::statements($statement->stmts, $statement->name?->toString(), $file, $findings);
                }
                continue;
            }
            $problem = self::problem($statement, $namespace);
            if ($problem !== null) {
                self::finding($file, $statement->getStartLine(), $problem . '; ' . self::SHAPE, $findings);
            }
        }
    }

    /** What `$statement` holds that an autoload file may not, in a namespaced scope or not; null if it is allowed. */
    private static function problem(Node\Stmt $statement, ?string $namespace): ?string
    {
        $namespaced = $namespace !== null;
        if ((new NodeFinder())->findFirstInstanceOf($statement, Node\Expr\Include_::class) !== null) {
            return 'a require or include';
        }
        if ($statement instanceof Node\Stmt\Declare_) {
            foreach ($statement->declares as $declare) {
                if ($declare->key->toLowerString() !== 'strict_types') {
                    return 'a declare other than strict_types';
                }
            }
            return null;
        }
        if ($statement instanceof Node\Stmt\Use_ || $statement instanceof Node\Stmt\GroupUse) {
            return null;
        }
        if ($statement instanceof Node\Stmt\Function_ || $statement instanceof Node\Stmt\Const_) {
            return $namespaced ? null : 'a function or constant outside a namespace';
        }
        if ($statement instanceof Node\Stmt\Expression && $namespaced && self::isNamespacedDefine($statement->expr)) {
            return null;
        }
        if ($statement instanceof Node\Stmt\If_ && $namespaced && self::isPolyfillGuard($statement, $namespace)) {
            return null;
        }
        return $statement instanceof Node\Stmt\ClassLike ? 'a class, interface, trait or enum' : 'another statement';
    }

    /** Whether `$expr` is define() of a namespaced constant name: a string literal with a namespace separator. */
    private static function isNamespacedDefine(Node\Expr $expr): bool
    {
        return str_contains(self::calledName($expr, 'define') ?? '', '\\');
    }

    /**
     * Whether `$if` is the polyfill guard of one declaration (K873): no elseif or else, a condition that is only
     * !function_exists() or !defined() of a name, and a body that is only the declaration of that name in `$namespace`,
     * a function for function_exists, a define() for defined.
     */
    private static function isPolyfillGuard(Node\Stmt\If_ $if, string $namespace): bool
    {
        if ($if->elseifs !== [] || $if->else !== null || count($if->stmts) !== 1) {
            return false;
        }
        if (!$if->cond instanceof Node\Expr\BooleanNot) {
            return false;
        }
        $declared = $if->stmts[0];
        $function = self::calledName($if->cond->expr, 'function_exists');
        if ($function !== null) {
            return $declared instanceof Node\Stmt\Function_
                && strtolower($function) === strtolower($namespace . '\\' . $declared->name->toString());
        }
        $constant = self::calledName($if->cond->expr, 'defined');
        return $constant !== null && str_contains($constant, '\\') && $declared instanceof Node\Stmt\Expression
            && self::calledName($declared->expr, 'define') === $constant;
    }

    /** The string literal that `$expr` passes to the function `$function`, without a leading separator, or null. */
    private static function calledName(Node\Expr $expr, string $function): ?string
    {
        if (!$expr instanceof Node\Expr\FuncCall || !$expr->name instanceof Node\Name) {
            return null;
        }
        if ($expr->name->toLowerString() !== $function) {
            return null;
        }
        $name = $expr->args[0]->value ?? null;
        return $name instanceof Node\Scalar\String_ ? ltrim($name->value, '\\') : null;
    }
}

<?php

// The visitor of extract.php: the public symbol ids of the nodes of a PHP syntax tree, read with nikic/php-parser.

declare(strict_types=1);

namespace Polyspec\Kit\Symbols;

use PhpParser\Node;
use PhpParser\NodeVisitorAbstract;

/**
 * Collects the public symbol ids of the nodes that it visits. A class, function, constant, method or property whose docblock
 * carries @internal is no public API (K307), and a class that carries it hides its members.
 */
final class PublicSymbols extends NodeVisitorAbstract
{
    /** @var list<string> */
    public array $symbols = [];

    public function enterNode(Node $node): null
    {
        if ($this->internal($node)) {
            return null;
        }
        if ($node instanceof Node\Stmt\ClassLike && $node->namespacedName !== null) {
            $class = $node->namespacedName->toString();
            $this->symbols[] = $class;
            foreach ($node->stmts as $member) {
                $this->member($class, $member, $node instanceof Node\Stmt\Interface_);
            }
        } elseif ($node instanceof Node\Stmt\Function_) {
            $this->symbols[] = $node->namespacedName->toString();
        } elseif ($node instanceof Node\Stmt\Const_) {
            foreach ($node->consts as $const) {
                $this->symbols[] = $const->namespacedName->toString();
            }
        }
        return null;
    }

    /** Whether the docblock of `$node` carries an @internal tag, as phpstan and psalm read it: the tag opens a docblock line. */
    private function internal(Node $node): bool
    {
        $doc = $node->getDocComment();
        return $doc !== null && preg_match('/^[ \t]*(?:\/\*\*|\*)?[ \t]*@internal(?:\s|$)/m', $doc->getText()) === 1;
    }

    /** Adds the public member `$member` of the class `$class`; every member of an interface is public. */
    private function member(string $class, Node $member, bool $interface): void
    {
        if ($this->internal($member)) {
            return;
        }
        if ($member instanceof Node\Stmt\ClassMethod && ($interface || $member->isPublic())) {
            $this->symbols[] = "{$class}::{$member->name}";
            if ($member->name->toLowerString() === '__construct') {
                foreach ($member->params as $param) {
                    $name = $param->var instanceof Node\Expr\Variable ? $param->var->name : null;
                    if ($param->isPublic() && is_string($name)) {
                        $this->symbols[] = "{$class}::\${$name}";
                    }
                }
            }
        } elseif ($member instanceof Node\Stmt\ClassConst && ($interface || $member->isPublic())) {
            foreach ($member->consts as $const) {
                $this->symbols[] = "{$class}::{$const->name}";
            }
        } elseif ($member instanceof Node\Stmt\EnumCase) {
            $this->symbols[] = "{$class}::{$member->name}";
        } elseif ($member instanceof Node\Stmt\Property && $member->isPublic()) {
            foreach ($member->props as $property) {
                $this->symbols[] = "{$class}::\${$property->name}";
            }
        }
    }
}

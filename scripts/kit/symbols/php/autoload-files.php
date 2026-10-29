<?php

// The autoload files of the Composer packages, checked by lint-php (K377): an autoload file holds only declarations of
// namespaced functions and constants (S2). The check reads the files with nikic/php-parser (AutoloadFiles.php), as
// extract.php reads the symbols, so the rule reads the syntax tree; nothing is loaded or run.
//
//   php autoload-files.php <vendor/autoload.php of the install> <file>...
//   php autoload-files.php --guards <vendor/autoload.php of the install> < {"<file>": "<text>", ...}
//
// Prints a finding for each statement that is not allowed, as "file:line: message", and exits 1 when there is one.
// With --guards it prints "file:line" for each polyfill guard of the texts that standard input maps by file
// (divergence-check, K883).

declare(strict_types=1);

use Polyspec\Kit\Symbols\AutoloadFiles;

if (($argv[1] ?? '') === '--guards' && $argc === 3) {
    require $argv[2];
    require __DIR__ . '/AutoloadFiles.php';
    AutoloadFiles::guards((array) json_decode((string) stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR));
    exit(0);
}
if ($argc < 3) {
    fwrite(STDERR, "usage: php autoload-files.php <vendor/autoload.php> <file>...\n");
    exit(2);
}
require $argv[1];
require __DIR__ . '/AutoloadFiles.php';

exit(AutoloadFiles::check(array_slice($argv, 2)) === 0 ? 0 : 1);

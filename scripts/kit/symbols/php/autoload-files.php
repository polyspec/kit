<?php

// The autoload files of the Composer packages, checked by lint-php (K377): an autoload file holds only declarations of
// namespaced functions and constants (S2). The check reads the files with nikic/php-parser (AutoloadFiles.php), as
// extract.php reads the symbols, so the rule reads the syntax tree; nothing is loaded or run.
//
//   php autoload-files.php <vendor/autoload.php of the install> <file>...
//
// Prints a finding for each statement that is not allowed, as "file:line: message", and exits 1 when there is one.

declare(strict_types=1);

use Polyspec\Kit\Symbols\AutoloadFiles;

if ($argc < 3) {
    fwrite(STDERR, "usage: php autoload-files.php <vendor/autoload.php> <file>...\n");
    exit(2);
}
require $argv[1];
require __DIR__ . '/AutoloadFiles.php';

exit(AutoloadFiles::check(array_slice($argv, 2)) === 0 ? 0 : 1);

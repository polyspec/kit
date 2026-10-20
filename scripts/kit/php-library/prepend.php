<?php

// Prepended to the PHPUnit of an extension run (run-tests.mts --without-library, K329): the tests of the PHP library
// run against the extension, with the autoloader that holds the dependencies and the autoload-dev of the library and
// none of its own autoload. PHPUnit takes its autoloader from $GLOBALS['_composer_autoload_path'], which is that
// autoloader here; at the end of the run no source of the library may have been included, so a test that requires a
// source of the library fails the run.

declare(strict_types=1);

$autoload = getenv('KIT_PHP_AUTOLOAD');
$sources = json_decode((string) getenv('KIT_PHP_LIBRARY_SOURCES'), true, 512, JSON_THROW_ON_ERROR);
if (!is_string($autoload) || !is_array($sources)) {
    fwrite(STDERR, 'prepend.php: KIT_PHP_AUTOLOAD and KIT_PHP_LIBRARY_SOURCES name the autoloader'
        . " and the sources of the library\n");
    exit(2);
}
$GLOBALS['_composer_autoload_path'] = $autoload;

register_shutdown_function(static function () use ($sources): void {
    $loaded = array_values(array_filter(
        get_included_files(),
        static fn (string $file): bool => array_filter(
            $sources,
            static fn (string $source): bool => $file === $source || str_starts_with($file, rtrim($source, '/') . '/'),
        ) !== [],
    ));
    if ($loaded !== []) {
        fwrite(STDERR, 'A source of the PHP library was loaded, so the run did not test the extension: '
            . implode(', ', $loaded) . "\n");
        exit(1);
    }
});

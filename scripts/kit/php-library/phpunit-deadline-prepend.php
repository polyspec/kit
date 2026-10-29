<?php

declare(strict_types=1);

$autoload = getenv('KIT_PHPUNIT_AUTOLOAD');
if (!is_string($autoload) || !is_file($autoload)) {
    fwrite(STDERR, "phpunit-deadline-prepend.php: the PHPUnit Composer autoloader is missing\n");
    exit(2);
}

require_once $autoload;
require_once __DIR__ . '/phpunit-deadline-subscriber.php';
require_once __DIR__ . '/phpunit-deadline-extension.php';

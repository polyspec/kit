PHP_ARG_ENABLE([polyspec_demo], [whether to enable polyspec_demo], [AS_HELP_STRING([--enable-polyspec-demo], [Enable polyspec_demo])], [no])

if test "$PHP_POLYSPEC_DEMO" != "no"; then
  dnl The version of the extension is the version of its package: composer.json lies beside src/ (K295).
  PHP_POLYSPEC_DEMO_VERSION=`sed -n 's/.*"version": *"\([[^"]]*\)".*/\1/p' "$srcdir/../composer.json"`
  AC_DEFINE_UNQUOTED([PHP_POLYSPEC_DEMO_VERSION], ["$PHP_POLYSPEC_DEMO_VERSION"], [The version of the package])
  PHP_NEW_EXTENSION([polyspec_demo], [polyspec_demo.c], [$ext_shared])
fi

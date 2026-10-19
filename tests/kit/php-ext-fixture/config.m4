PHP_ARG_ENABLE([polyspec_demo], [whether to enable polyspec_demo], [AS_HELP_STRING([--enable-polyspec-demo], [Enable polyspec_demo])], [no])

if test "$PHP_POLYSPEC_DEMO" != "no"; then
  PHP_NEW_EXTENSION([polyspec_demo], [polyspec_demo.c], [$ext_shared])
fi

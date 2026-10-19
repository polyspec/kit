/* The extension of the declaration test of php-extension.test.mts: the function Polyspec\Demo\add and the class
 * Polyspec\Demo\Counter of its stub. */
#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "php.h"
#include "zend_exceptions.h"
#include "polyspec_demo_arginfo.h"

static zend_class_entry *counter_entry;

ZEND_FUNCTION(Polyspec_Demo_add)
{
	zend_long a;
	zend_long b = 1;

	ZEND_PARSE_PARAMETERS_START(1, 2)
		Z_PARAM_LONG(a)
		Z_PARAM_OPTIONAL
		Z_PARAM_LONG(b)
	ZEND_PARSE_PARAMETERS_END();

	RETURN_LONG(a + b);
}

ZEND_METHOD(Polyspec_Demo_Counter, __construct)
{
	zend_long start = 0;

	ZEND_PARSE_PARAMETERS_START(0, 1)
		Z_PARAM_OPTIONAL
		Z_PARAM_LONG(start)
	ZEND_PARSE_PARAMETERS_END();

	zend_update_property_long(counter_entry, Z_OBJ_P(ZEND_THIS), "value", sizeof("value") - 1, start);
}

ZEND_METHOD(Polyspec_Demo_Counter, next)
{
	zval rv;
	zval *value;

	ZEND_PARSE_PARAMETERS_NONE();

	value = zend_read_property(counter_entry, Z_OBJ_P(ZEND_THIS), "value", sizeof("value") - 1, 0, &rv);
	zend_update_property_long(counter_entry, Z_OBJ_P(ZEND_THIS), "value", sizeof("value") - 1, Z_LVAL_P(value) + 1);
	RETURN_LONG(Z_LVAL_P(value) + 1);
}

static PHP_MINIT_FUNCTION(polyspec_demo)
{
	counter_entry = register_class_Polyspec_Demo_Counter();
	zend_declare_property_long(counter_entry, "value", sizeof("value") - 1, 0, ZEND_ACC_PRIVATE);
	return SUCCESS;
}

zend_module_entry polyspec_demo_module_entry = {
	STANDARD_MODULE_HEADER,
	"polyspec_demo",
	ext_functions,
	PHP_MINIT(polyspec_demo),
	NULL,
	NULL,
	NULL,
	NULL,
	"0.0.0",
	STANDARD_MODULE_PROPERTIES
};

#ifdef COMPILE_DL_POLYSPEC_DEMO
ZEND_GET_MODULE(polyspec_demo)
#endif

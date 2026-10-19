/* This is a generated file, edit the .stub.php file instead.
 * Stub hash: b636273c3c0e89d849539e5974627fee4d1222b5 */

ZEND_BEGIN_ARG_WITH_RETURN_TYPE_INFO_EX(arginfo_Polyspec_Demo_add, 0, 1, IS_LONG, 0)
	ZEND_ARG_TYPE_INFO(0, a, IS_LONG, 0)
	ZEND_ARG_TYPE_INFO_WITH_DEFAULT_VALUE(0, b, IS_LONG, 0, "1")
ZEND_END_ARG_INFO()

ZEND_BEGIN_ARG_INFO_EX(arginfo_class_Polyspec_Demo_Counter___construct, 0, 0, 0)
	ZEND_ARG_TYPE_INFO_WITH_DEFAULT_VALUE(0, start, IS_LONG, 0, "0")
ZEND_END_ARG_INFO()

ZEND_BEGIN_ARG_WITH_RETURN_TYPE_INFO_EX(arginfo_class_Polyspec_Demo_Counter_next, 0, 0, IS_LONG, 0)
ZEND_END_ARG_INFO()


ZEND_FUNCTION(Polyspec_Demo_add);
ZEND_METHOD(Polyspec_Demo_Counter, __construct);
ZEND_METHOD(Polyspec_Demo_Counter, next);


static const zend_function_entry ext_functions[] = {
	ZEND_NS_FALIAS("Polyspec\\Demo", add, Polyspec_Demo_add, arginfo_Polyspec_Demo_add)
	ZEND_FE_END
};


static const zend_function_entry class_Polyspec_Demo_Counter_methods[] = {
	ZEND_ME(Polyspec_Demo_Counter, __construct, arginfo_class_Polyspec_Demo_Counter___construct, ZEND_ACC_PUBLIC)
	ZEND_ME(Polyspec_Demo_Counter, next, arginfo_class_Polyspec_Demo_Counter_next, ZEND_ACC_PUBLIC)
	ZEND_FE_END
};

static zend_class_entry *register_class_Polyspec_Demo_Counter(void)
{
	zend_class_entry ce, *class_entry;

	INIT_NS_CLASS_ENTRY(ce, "Polyspec\\Demo", "Counter", class_Polyspec_Demo_Counter_methods);
	class_entry = zend_register_internal_class_ex(&ce, NULL);
	class_entry->ce_flags |= ZEND_ACC_FINAL;

	return class_entry;
}

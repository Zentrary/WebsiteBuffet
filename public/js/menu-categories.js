((root, factory) => {
  const categories = factory();
  if (typeof module === 'object' && module.exports) module.exports = categories;
  else root.MenuCategories = categories;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_CATEGORY = 'uncategorized';

  const MENU_CATEGORIES = Object.freeze([
    'set',
    'appetizer',
    'main',
    'sushi',
    'meat',
    'seafood',
    'veg',
    'noodle',
    'soup',
    'sauce',
    'soup_sauce',
    'side',
    'dessert',
    'drink',
    'dessert_drink',
    DEFAULT_CATEGORY,
  ]);

  const LEGACY_MENU_CATEGORIES = Object.freeze([
    'set_menu',
    'sukiyaki',
    'hotpan',
    'maki',
    'sashimi',
    'japanese_main',
    'chinese',
    'fried',
    'dim_sum',
    'yum',
    'salad',
    'fresh_meat',
    'offal',
    'vegetable',
    'mushroom',
    'tofu',
    'rice',
    'sukiyaki_hotpan',
    'sushi_roll',
    'chinese_stirfry',
    'fried_appetizer',
    'salad_yum',
    'fresh_seafood',
    'vegetable_tofu',
    'noodle_rice_side',
  ]);

  const ALL_MENU_CATEGORIES = Object.freeze([...MENU_CATEGORIES, ...LEGACY_MENU_CATEGORIES]);

  function key(value) {
    return typeof value === 'string' && value.trim() ? value : DEFAULT_CATEGORY;
  }

  function label(value, translate) {
    const category = key(value);
    const translationKey = `menu.category.${category}`;
    const translated = typeof translate === 'function' ? translate(translationKey) : null;

    return typeof translated === 'string' && translated && translated !== translationKey
      ? translated
      : category;
  }

  function orderedKeys(values) {
    const present = new Set(values.map(key));
    const ordered = ALL_MENU_CATEGORIES.filter((category) => present.delete(category));
    return [...ordered, ...present];
  }

  return Object.freeze({
    DEFAULT_CATEGORY,
    MENU_CATEGORIES,
    LEGACY_MENU_CATEGORIES,
    ALL_MENU_CATEGORIES,
    key,
    label,
    orderedKeys,
  });
});

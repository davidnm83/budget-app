// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.
/**
 * Default emoji for categories, category groups and account types, used until you pick your own.
 * Matched on the lowercased name; anything unknown gets a neutral dot.
 */
const CATEGORY: Record<string, string> = {
  // income
  paycheck: '💼', paycheque: '💼', 'repayment from others': '🔁', 'other income': '💵', refunds: '↩️', rewards: '🎁',
  'money from family': '👪', 'tax returns & benefits': '🏛️', cashback: '🪙', 'interest income': '📈', sales: '🏷️', 'student loans': '🎓',
  // home & bills
  rent: '🏠', furniture: '🛋️', 'household items': '💡', home: '🏠', 'phone bill': '📱', 'phone & internet': '📱', subscriptions: '🔁',
  // fees
  'bank charges & fees': '🏦', 'credit card interest': '💳', 'installment plan': '🧾', 'credit card debt': '💳', 'interest & fees': '🏦',
  // food
  groceries: '🛒', 'fast food': '🍔', snacks: '🍫', 'food delivery': '🛵', restaurants: '🍽️', 'coffee shops': '☕', 'movie snacks': '🍿',
  // transport
  'car payments': '🚙', 'car payment': '🚙', 'vehicle repairs & maintenance': '🔧', 'public transportation': '🚇', gas: '⛽',
  'other transportation': '🚕', taxis: '🚕', parking: '🅿️', 'parking tickets': '🎫', 'license & vehicle fees': '🪪', 'vehicle insurance': '🛡️',
  'car insurance': '🛡️', 'car wash': '🫧', 'parking & transit': '🅿️',
  // subscriptions
  shopping: '🛍️', tv: '📺', sports: '🏸', music: '🎧', news: '📰', other: '🔸', 'gaming subscription': '🎮',
  // shopping & electronics
  clothing: '👕', 'general goods': '📦', shoes: '👟', 'household supplies': '🧽', software: '💾', gaming: '🎮',
  accessories: '🔌', keyboard: '⌨️', pc: '🖥️', phone: '📱', tablet: '📲', laptop: '💻',
  // health, travel, fun, care, services, education
  medical: '🩺', gym: '🏋️', 'other health & wellness': '🌿', dentist: '🦷', eyecare: '👓', 'health insurance': '⚕️', medication: '💊', health: '🩺',
  'air travel': '✈️', hotel: '🏨', gambling: '🎲', 'alcohol & bars': '🍺', movies: '🎬', entertainment: '🎬',
  hair: '💈', laundry: '🧺', toiletries: '🧴', 'personal care': '🧴', printing: '🖨️', 'professional services': '🧑‍💼', shipping: '📮', tailor: '🧵',
  'student loan': '🎓', tuition: '🏫', 'books & supplies': '📚', education: '🏫', 'gifts & donations': '🎁', gifts: '🎁',
  investments: '📈', taxes: '🧾', insurance: '🛡️', 'other expenses': '🔸', 'moving expenses': '🚚', 'work expenses': '🧰', savings: '🐷',
  // transfers
  transfer: '🔄', 'money owed': '🤝', 'credit card payment': '💳', 'buy & trade': '🔄', 'sell & trade': '🔄',
};

const GROUP: Record<string, string> = {
  income: '💰', home: '🏠', 'bills & utilities': '🧾', 'fees & charges': '🏦', 'food & dining': '🍽️', food: '🍽️', transportation: '🚗', car: '🚗',
  'subscription services': '🔁', shopping: '🛍️', electronics: '🖥️', 'health & wellness': '🩺', health: '🩺', 'travel & vacation': '✈️',
  entertainment: '🎬', fun: '🎬', 'personal care': '🧴', services: '🧑‍💼', education: '🎓', transfers: '🔄', bills: '🧾', other: '🔸',
};

export function categoryIcon(name: string, icon?: string | null): string {
  return icon || CATEGORY[name.trim().toLowerCase()] || '•';
}

export function groupIcon(name: string, icon?: string | null): string {
  return icon || GROUP[name.trim().toLowerCase()] || CATEGORY[name.trim().toLowerCase()] || '•';
}

export function accountIcon(type: string | null, icon?: string | null): string {
  if (icon) return icon;
  return type === 'credit' ? '💳' : type === 'loan' ? '🧾' : type === 'investment' ? '📈' : '🏦';
}

/**
 * 国家代码数据接口定义
 */
export interface CountryCode {
  /** 国家/地区代码 */
  code: string
  /** 国家/地区名称（英文） */
  name: string
  /** 国家/地区名称（中文） */
  nameCN: string
  /** 国家/地区名称（本地语言，优先显示） */
  nameLocal?: string
  /** 国旗emoji */
  flag: string
  /** 电话区号 */
  dialCode: string
}

/**
 * 常见国家和地区代码数据
 * 注意：对于政治敏感地区，使用中性的表述
 */
export const countryCodes: CountryCode[] = [
  // 中国大陆
  {
    code: 'CN',
    name: 'China',
    nameCN: '中国',
    nameLocal: '中国',
    flag: '🇨🇳',
    dialCode: '+86'
  },
  // 香港特别行政区
  {
    code: 'HK',
    name: 'Hong Kong SAR',
    nameCN: '香港特别行政区',
    flag: '🇭🇰',
    dialCode: '+852'
  },
  // 澳门特别行政区
  {
    code: 'MO',
    name: 'Macao SAR',
    nameCN: '澳门特别行政区',
    flag: '🇲🇴',
    dialCode: '+853'
  },
  // 美国
  {
    code: 'US',
    name: 'United States',
    nameCN: '美国',
    nameLocal: 'United States',
    flag: '🇺🇸',
    dialCode: '+1'
  },
  // 加拿大
  {
    code: 'CA',
    name: 'Canada',
    nameCN: '加拿大',
    nameLocal: 'Canada',
    flag: '🇨🇦',
    dialCode: '+1'
  },
  // 英国
  {
    code: 'GB',
    name: 'United Kingdom',
    nameCN: '英国',
    nameLocal: 'United Kingdom',
    flag: '🇬🇧',
    dialCode: '+44'
  },
  // 日本
  {
    code: 'JP',
    name: 'Japan',
    nameCN: '日本',
    nameLocal: '日本',
    flag: '🇯🇵',
    dialCode: '+81'
  },
  // 韩国
  {
    code: 'KR',
    name: 'South Korea',
    nameCN: '韩国',
    nameLocal: '대한민국',
    flag: '🇰🇷',
    dialCode: '+82'
  },
  // 新加坡
  {
    code: 'SG',
    name: 'Singapore',
    nameCN: '新加坡',
    nameLocal: 'Singapore',
    flag: '🇸🇬',
    dialCode: '+65'
  },
  // 马来西亚
  {
    code: 'MY',
    name: 'Malaysia',
    nameCN: '马来西亚',
    nameLocal: 'Malaysia',
    flag: '🇲🇾',
    dialCode: '+60'
  },
  // 泰国
  {
    code: 'TH',
    name: 'Thailand',
    nameCN: '泰国',
    nameLocal: 'ประเทศไทย',
    flag: '🇹🇭',
    dialCode: '+66'
  },
  // 印度
  {
    code: 'IN',
    name: 'India',
    nameCN: '印度',
    nameLocal: 'भारत',
    flag: '🇮🇳',
    dialCode: '+91'
  },
  // 澳大利亚
  {
    code: 'AU',
    name: 'Australia',
    nameCN: '澳大利亚',
    nameLocal: 'Australia',
    flag: '🇦🇺',
    dialCode: '+61'
  },
  // 新西兰
  {
    code: 'NZ',
    name: 'New Zealand',
    nameCN: '新西兰',
    nameLocal: 'New Zealand',
    flag: '🇳🇿',
    dialCode: '+64'
  },
  // 德国
  {
    code: 'DE',
    name: 'Germany',
    nameCN: '德国',
    flag: '🇩🇪',
    dialCode: '+49'
  },
  // 法国
  {
    code: 'FR',
    name: 'France',
    nameCN: '法国',
    flag: '🇫🇷',
    dialCode: '+33'
  },
  // 意大利
  {
    code: 'IT',
    name: 'Italy',
    nameCN: '意大利',
    flag: '🇮🇹',
    dialCode: '+39'
  },
  // 西班牙
  {
    code: 'ES',
    name: 'Spain',
    nameCN: '西班牙',
    flag: '🇪🇸',
    dialCode: '+34'
  },
  // 荷兰
  {
    code: 'NL',
    name: 'Netherlands',
    nameCN: '荷兰',
    flag: '🇳🇱',
    dialCode: '+31'
  },
  // 瑞士
  {
    code: 'CH',
    name: 'Switzerland',
    nameCN: '瑞士',
    flag: '🇨🇭',
    dialCode: '+41'
  },
  // 俄罗斯
  {
    code: 'RU',
    name: 'Russia',
    nameCN: '俄罗斯',
    flag: '🇷🇺',
    dialCode: '+7'
  },
  // 巴西
  {
    code: 'BR',
    name: 'Brazil',
    nameCN: '巴西',
    flag: '🇧🇷',
    dialCode: '+55'
  },
  // 墨西哥
  {
    code: 'MX',
    name: 'Mexico',
    nameCN: '墨西哥',
    flag: '🇲🇽',
    dialCode: '+52'
  },
  // 阿根廷
  {
    code: 'AR',
    name: 'Argentina',
    nameCN: '阿根廷',
    flag: '🇦🇷',
    dialCode: '+54'
  },
  // 南非
  {
    code: 'ZA',
    name: 'South Africa',
    nameCN: '南非',
    flag: '🇿🇦',
    dialCode: '+27'
  },
  // 埃及
  {
    code: 'EG',
    name: 'Egypt',
    nameCN: '埃及',
    flag: '🇪🇬',
    dialCode: '+20'
  },
  // 土耳其
  {
    code: 'TR',
    name: 'Turkey',
    nameCN: '土耳其',
    flag: '🇹🇷',
    dialCode: '+90'
  },
  // 阿联酋
  {
    code: 'AE',
    name: 'United Arab Emirates',
    nameCN: '阿联酋',
    flag: '🇦🇪',
    dialCode: '+971'
  },
  // 沙特阿拉伯
  {
    code: 'SA',
    name: 'Saudi Arabia',
    nameCN: '沙特阿拉伯',
    flag: '🇸🇦',
    dialCode: '+966'
  },
  // 以色列
  {
    code: 'IL',
    name: 'Israel',
    nameCN: '以色列',
    flag: '🇮🇱',
    dialCode: '+972'
  },
  // 印度尼西亚
  {
    code: 'ID',
    name: 'Indonesia',
    nameCN: '印度尼西亚',
    flag: '🇮🇩',
    dialCode: '+62'
  },
  // 菲律宾
  {
    code: 'PH',
    name: 'Philippines',
    nameCN: '菲律宾',
    flag: '🇵🇭',
    dialCode: '+63'
  },
  // 越南
  {
    code: 'VN',
    name: 'Vietnam',
    nameCN: '越南',
    flag: '🇻🇳',
    dialCode: '+84'
  }
]

/**
 * 根据国家代码查找国家信息
 * @param code 国家代码
 * @returns 国家信息或undefined
 */
export function findCountryByCode(code: string): CountryCode | undefined {
  return countryCodes.find(country => country.code === code)
}

/**
 * 根据电话区号查找国家信息
 * @param dialCode 电话区号
 * @returns 国家信息数组
 */
export function findCountriesByDialCode(dialCode: string): CountryCode[] {
  return countryCodes.filter(country => country.dialCode === dialCode)
}

/**
 * 搜索国家（支持中英文名称、本地语言名称和代码搜索）
 * @param query 搜索关键词
 * @returns 匹配的国家信息数组
 */
export function searchCountries(query: string): CountryCode[] {
  if (!query.trim()) {
    return countryCodes
  }

  const lowerQuery = query.toLowerCase()
  return countryCodes.filter(country =>
    country.name.toLowerCase().includes(lowerQuery) ||
    country.nameCN.includes(query) ||
    (country.nameLocal && country.nameLocal.toLowerCase().includes(lowerQuery)) ||
    country.code.toLowerCase().includes(lowerQuery) ||
    country.dialCode.includes(query)
  )
}

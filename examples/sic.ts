/**
 * A slice of the SEC's Standard Industrial Classification taxonomy: two-digit
 * major groups, each belonging to one broader division.
 *
 * The cookbook this example follows uses all 75 groups the SEC publishes. This
 * is a representative subset — enough that the classification is genuinely hard
 * and the confidence threshold has something to do.
 */

export const divisions = {
  A: "Agriculture, forestry, and fishing",
  B: "Mining",
  C: "Construction",
  D: "Manufacturing",
  E: "Transportation, communications, electric, gas, and sanitary services",
  F: "Wholesale trade",
  G: "Retail trade",
  H: "Finance, insurance, and real estate",
  I: "Services"
} as const

export type DivisionCode = keyof typeof divisions

export const groups = {
  "01": { name: "Agricultural production — crops", division: "A" },
  "02": { name: "Agricultural production — livestock and animal specialties", division: "A" },
  "08": { name: "Forestry", division: "A" },
  "09": { name: "Fishing, hunting, and trapping", division: "A" },
  "10": { name: "Metal mining", division: "B" },
  "12": { name: "Coal mining", division: "B" },
  "13": { name: "Oil and gas extraction", division: "B" },
  "14": { name: "Mining and quarrying of nonmetallic minerals, except fuels", division: "B" },
  "15": { name: "Building construction — general contractors and operative builders", division: "C" },
  "16": { name: "Heavy construction other than building construction", division: "C" },
  "17": { name: "Construction — special trade contractors", division: "C" },
  "20": { name: "Food and kindred products", division: "D" },
  "22": { name: "Textile mill products", division: "D" },
  "23": { name: "Apparel and other finished products made from fabrics", division: "D" },
  "24": { name: "Lumber and wood products, except furniture", division: "D" },
  "26": { name: "Paper and allied products", division: "D" },
  "27": { name: "Printing, publishing, and allied industries", division: "D" },
  "28": { name: "Chemicals and allied products, including pharmaceuticals", division: "D" },
  "29": { name: "Petroleum refining and related industries", division: "D" },
  "30": { name: "Rubber and miscellaneous plastics products", division: "D" },
  "32": { name: "Stone, clay, glass, and concrete products", division: "D" },
  "33": { name: "Primary metal industries", division: "D" },
  "34": { name: "Fabricated metal products, except machinery", division: "D" },
  "35": { name: "Industrial and commercial machinery and computer equipment", division: "D" },
  "36": { name: "Electronic and other electrical equipment, except computers", division: "D" },
  "37": { name: "Transportation equipment", division: "D" },
  "38": { name: "Measuring, analyzing, and controlling instruments", division: "D" },
  "39": { name: "Miscellaneous manufacturing industries", division: "D" },
  "40": { name: "Railroad transportation", division: "E" },
  "42": { name: "Motor freight transportation and warehousing", division: "E" },
  "44": { name: "Water transportation", division: "E" },
  "45": { name: "Transportation by air", division: "E" },
  "48": { name: "Communications", division: "E" },
  "49": { name: "Electric, gas, and sanitary services", division: "E" },
  "50": { name: "Wholesale trade — durable goods", division: "F" },
  "51": { name: "Wholesale trade — nondurable goods", division: "F" },
  "52": { name: "Building materials, hardware, and garden supply retailers", division: "G" },
  "53": { name: "General merchandise stores", division: "G" },
  "54": { name: "Food stores", division: "G" },
  "55": { name: "Automotive dealers and gasoline service stations", division: "G" },
  "56": { name: "Apparel and accessory stores", division: "G" },
  "57": { name: "Home furniture, furnishings, and equipment stores", division: "G" },
  "58": { name: "Eating and drinking places", division: "G" },
  "59": { name: "Miscellaneous retail", division: "G" },
  "60": { name: "Depository institutions — banks and savings institutions", division: "H" },
  "61": { name: "Nondepository credit institutions", division: "H" },
  "62": { name: "Security and commodity brokers, dealers, and exchanges", division: "H" },
  "63": { name: "Insurance carriers", division: "H" },
  "64": { name: "Insurance agents, brokers, and service", division: "H" },
  "65": { name: "Real estate — operators, lessors, agents, and managers", division: "H" },
  "67": { name: "Holding and other investment offices", division: "H" },
  "70": { name: "Hotels, rooming houses, camps, and other lodging places", division: "I" },
  "72": { name: "Personal services", division: "I" },
  "73": { name: "Business services, including software and data processing", division: "I" },
  "78": { name: "Motion picture production and distribution", division: "I" },
  "79": { name: "Amusement and recreation services", division: "I" },
  "80": { name: "Health services", division: "I" },
  "82": { name: "Educational services", division: "I" },
  "83": { name: "Social services", division: "I" },
  "87": { name: "Engineering, accounting, research, and management services", division: "I" }
} as const satisfies { readonly [code: string]: { readonly name: string; readonly division: DivisionCode } }

export type GroupCode = keyof typeof groups

/**
 * The broader division a group belongs to. This is the local lookup the
 * cookbook falls back to when the model is not confident enough to be trusted
 * with the narrow label.
 */
export const divisionOf = (code: GroupCode): DivisionCode => groups[code].division

export const divisionName = (code: GroupCode): string => divisions[divisionOf(code)]

export const groupName = (code: GroupCode): string => groups[code].name

export const groupCodes = Object.keys(groups) as Array<GroupCode>

/**
 * Stand-ins for the "Item 1 — Business" section of an annual report.
 *
 * Written for this example, not extracted from real filings. The first three
 * are unambiguous; the rest are deliberately hard in the ways the cookbook
 * names as its low-confidence cases — development-stage companies describing
 * planned rather than current operations, holdings mid-divestiture, vertically
 * integrated businesses that span divisions, and conglomerates with a finance
 * arm bolted on.
 *
 * `expected` is the SIC major group a careful human reader would assign. For
 * several of these that judgment is genuinely arguable, which is the point:
 * a taxonomy with one slot per company meets companies that occupy three.
 */
import type { GroupCode } from "./sic.js"

export interface Filing {
  readonly id: string
  readonly expected: GroupCode
  /** Why this case is easy or hard, shown in the UI. */
  readonly note: string
  readonly text: string
}

export const filings: ReadonlyArray<Filing> = [
  {
    id: "NOVAGRID",
    expected: "49",
    note: "Unambiguous: a regulated utility describing regulated utility operations.",
    text:
      "The Company generates, transmits and distributes electricity to approximately 1.4 million " +
      "residential, commercial and industrial customers across three states. Generation capacity is " +
      "provided by a mix of combined-cycle natural gas units, two hydroelectric facilities and " +
      "purchased power agreements. Rates for retail service are set by state utility commissions. " +
      "The Company also operates a regulated natural gas distribution segment serving 300,000 meters."
  },
  {
    id: "HELIOTEX",
    expected: "28",
    note: "Unambiguous: makes chemicals, in plants, from petrochemical feedstocks.",
    text:
      "The Company formulates and manufactures specialty coatings, adhesives and industrial resins at " +
      "four plants in the United States and one in Germany. Products are sold to automotive, " +
      "aerospace and construction customers, generally under multi-year supply agreements. Raw " +
      "materials consist principally of petrochemical feedstocks. The Company holds 87 patents " +
      "covering polymer chemistries and maintains research laboratories at two of its sites."
  },
  {
    id: "CLEARFIELD",
    expected: "60",
    note: "Unambiguous: takes deposits, makes loans, FDIC insured.",
    text:
      "The Company is a bank holding company whose principal subsidiary accepts deposits from the " +
      "general public and originates commercial, residential mortgage and consumer loans through 46 " +
      "branch offices. Deposits are insured by the FDIC. Net interest income represents substantially " +
      "all of the Company's revenue. The Company is subject to examination by federal and state " +
      "banking regulators and to risk-based capital requirements."
  },
  {
    id: "HARBORLIGHT",
    expected: "70",
    note:
      "Hard, and hard across divisions: an operator of hotels that is also a landlord and a manager " +
      "of other people's property. Services (70) or real estate (65)?",
    text:
      "The Company owns fee simple title to eleven full-service hotels containing 3,240 rooms and " +
      "holds ground leases on two others. Nine of the owned properties are operated by the Company's " +
      "own personnel under franchise agreements with national brands; the remaining four are leased " +
      "in their entirety to unaffiliated operators in exchange for base and percentage rent. The " +
      "Company additionally provides asset management services to three private investment funds " +
      "that own hotels the Company does not, earning management and incentive fees. The Company has " +
      "elected to be taxed as a real estate investment trust and accordingly distributes " +
      "substantially all of its taxable income to shareholders. Revenue is reported in three " +
      "segments: hotel operations, rental income and management fees."
  },
  {
    id: "MERIDIAN-GROUP",
    expected: "37",
    note:
      "Hard: a three-segment conglomerate whose largest segment by revenue is not the one it leads " +
      "the filing with, plus a captive finance arm.",
    text:
      "The Company operates through three reportable segments. The Aerostructures segment machines " +
      "titanium and composite assemblies for commercial aircraft manufacturers and accounted for 46% " +
      "of consolidated revenue. The Flow Control segment designs and manufactures centrifugal pumps " +
      "and valves for municipal water and petrochemical customers and accounted for 38%. The " +
      "Financial Services segment, which accounted for the remaining 16%, originates equipment " +
      "leases and secured loans, primarily to purchasers of the Company's own products but " +
      "increasingly to unaffiliated third parties, and holds a portfolio of finance receivables of " +
      "$1.1 billion. Management evaluates segment performance on operating income before corporate " +
      "allocations."
  },
  {
    id: "CASCADE-MILLS",
    expected: "24",
    note:
      "Hard: vertically integrated from the tree to the shelf, which spans three divisions — " +
      "agriculture (08), manufacturing (24) and retail (52).",
    text:
      "The Company owns or holds long-term cutting rights on 620,000 acres of commercial timberland " +
      "in the Pacific Northwest. Harvested logs are transported to the Company's four sawmills and " +
      "one engineered-panel facility, where they are converted into dimensional lumber, plywood and " +
      "laminated veneer products. Approximately 40% of finished production is sold through the " +
      "Company's 23 retail building-supply yards, which also stock hardware, fasteners and roofing " +
      "materials purchased from unaffiliated suppliers; the balance is sold to distributors and " +
      "homebuilders. The Company does not separately report the timberland operations, as internal " +
      "log transfers are eliminated in consolidation."
  },
  {
    id: "ORCHARD-HOLDINGS",
    expected: "67",
    note:
      "Hard: a company mid-divestiture whose filing describes what it used to do and what it might " +
      "do next, but barely what it does now.",
    text:
      "Following the sale of the Company's industrial fastener subsidiaries in March of the prior " +
      "fiscal year, the Company's assets consist principally of $340 million in cash and marketable " +
      "securities, a 19% minority interest in a privately held distributor accounted for under the " +
      "equity method, and three commercial buildings in suburban office parks leased to unaffiliated " +
      "tenants under net leases expiring between 2029 and 2036. The Company has eleven employees, " +
      "all of whom are engaged in administration or the oversight of these investments. The Board " +
      "has retained advisors to evaluate alternatives for the deployment of capital, which may " +
      "include one or more acquisitions in industries unrelated to the Company's historical " +
      "operations, a return of capital to shareholders, or a combination of both."
  },
  {
    id: "VERITAS-LABS",
    expected: "28",
    note:
      "Hard: a development-stage company with no revenue, describing operations it intends to have " +
      "rather than operations it has.",
    text:
      "The Company is a development-stage enterprise and has not generated revenue from product " +
      "sales. Its lead candidate, a companion diagnostic intended to guide the selection of oncology " +
      "therapy, has completed analytical validation and has not been submitted for regulatory " +
      "clearance. The Company intends to establish internal manufacturing capability for assay kits " +
      "at a leased facility in Massachusetts, though no equipment has been placed in service. Under " +
      "a collaboration entered into last year, a pharmaceutical partner funds and conducts the " +
      "clinical studies necessary to support the Company's submissions, and the Company performs " +
      "sample analysis in its own laboratory on a fee-per-sample basis. Substantially all expenses " +
      "to date consist of research personnel, laboratory supplies and contracted services."
  },
  {
    id: "TIDEWATER-FOODS",
    expected: "20",
    note:
      "Hard: grows it, cans it, and sells it wholesale — agriculture (01), manufacturing (20) and " +
      "wholesale (51) all have a claim.",
    text:
      "The Company farms 31,000 owned and leased acres in the Delmarva region, planting principally " +
      "sweet corn, green beans and tomatoes on a rotating schedule. Substantially all of the " +
      "Company's harvest, together with produce purchased under contract from approximately 140 " +
      "independent growers, is delivered to the Company's two canning and freezing plants, which " +
      "operate on a seasonal basis. Finished goods are sold under the Company's own labels and as " +
      "private label to supermarket chains and food service distributors. The Company operates a " +
      "fleet of 60 refrigerated trailers and maintains cold storage at both plants. Purchased " +
      "produce has exceeded Company-grown produce in each of the last three seasons."
  },
  {
    id: "ARGENT-DIGITAL",
    expected: "73",
    note:
      "Hard: a software company that also earns regulated commissions — services (73) or insurance " +
      "brokerage (64)?",
    text:
      "The Company licenses a cloud-based policy administration and quoting platform to independent " +
      "insurance agencies on a per-seat subscription basis, and derives 71% of revenue from these " +
      "subscriptions and related implementation services. The Company's wholly owned subsidiary is " +
      "licensed as an insurance producer in 44 states and earns commissions on policies placed " +
      "through the platform where the subsidiary is named as agent of record; these commissions " +
      "represent the remaining 29% of revenue and carry substantially higher margins. The Company " +
      "does not underwrite insurance and assumes no underwriting risk. Platform development is " +
      "conducted by 190 engineers at facilities in Austin and Kraków."
  }
]

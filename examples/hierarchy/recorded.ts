/**
 * Hierarchical readings recorded from the live System One API: for each
 * filing, the root division answer and the level-2 group answer for every
 * division the root retained (`beamWidth` of them).
 *
 * Recorded 2026-09-17 from jev-1.13.0. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/hierarchy/record.ts
 *
 * Options a division or group answer gave zero weight to are omitted; the
 * live API returns the full distribution across every option offered. A
 * single recording is one draw from a distribution, not a measurement.
 */
import type { DivisionCode, GroupCode } from "../data/sic.js"

export interface Reading<Code extends string> {
  readonly probabilities: Partial<Record<Code, number>>
  readonly confidence: number
}

export interface FilingRecording {
  readonly division: Reading<DivisionCode>
  /** Keyed by division code — one entry per division the root retained. */
  readonly groups: { readonly [division: string]: Reading<GroupCode> }
  readonly usage: {
    readonly root: { readonly inputTokens: number; readonly outputTokens: number }
    readonly level2: { readonly inputTokens: number; readonly outputTokens: number }
  }
}

/** How many divisions were retained after the root request, when this was recorded. */
export const beamWidth = 3

export const recordedModel = "jev-1.13.0"

export const recorded: { readonly [id: string]: FilingRecording } = {
  "NOVAGRID": {
    division: {
      probabilities: {
        "E": 1
      },
      confidence: 1
    },
    groups: {
      "E": {
        probabilities: {
          "49": 1
        },
        confidence: 1
      },
      "G": {
        probabilities: {
          "59": 0.93,
          "55": 0.03,
          "52": 0.01,
          "53": 0.01,
          "57": 0.01,
          "58": 0.01
        },
        confidence: 0.92
      },
      "B": {
        probabilities: {
          "13": 0.79,
          "14": 0.11,
          "12": 0.07,
          "10": 0.03
        },
        confidence: 0.73
      }
    },
    usage: {
      root: { inputTokens: 538, outputTokens: 80 },
      level2: { inputTokens: 806, outputTokens: 195 }
    }
  },
  "HELIOTEX": {
    division: {
      probabilities: {
        "D": 1
      },
      confidence: 1
    },
    groups: {
      "D": {
        probabilities: {
          "28": 0.99,
          "30": 0.01
        },
        confidence: 0.99
      },
      "C": {
        probabilities: {
          "17": 0.91,
          "15": 0.07,
          "16": 0.02
        },
        confidence: 0.86
      },
      "B": {
        probabilities: {
          "14": 0.89,
          "13": 0.09,
          "10": 0.02
        },
        confidence: 0.85
      }
    },
    usage: {
      root: { inputTokens: 537, outputTokens: 80 },
      level2: { inputTokens: 925, outputTokens: 243 }
    }
  },
  "CLEARFIELD": {
    division: {
      probabilities: {
        "H": 1
      },
      confidence: 1
    },
    groups: {
      "H": {
        probabilities: {
          "60": 0.99,
          "67": 0.01
        },
        confidence: 0.99
      },
      "C": {
        probabilities: {
          "15": 0.54,
          "17": 0.24,
          "16": 0.22
        },
        confidence: 0.31
      },
      "E": {
        probabilities: {
          "49": 0.68,
          "48": 0.29,
          "40": 0.01,
          "42": 0.01,
          "44": 0.01
        },
        confidence: 0.62
      }
    },
    usage: {
      root: { inputTokens: 529, outputTokens: 80 },
      level2: { inputTokens: 782, outputTokens: 179 }
    }
  },
  "HARBORLIGHT": {
    division: {
      probabilities: {
        "H": 0.95,
        "I": 0.05
      },
      confidence: 0.94
    },
    groups: {
      "H": {
        probabilities: {
          "65": 1
        },
        confidence: 1
      },
      "I": {
        probabilities: {
          "70": 0.97,
          "87": 0.03
        },
        confidence: 0.96
      },
      "D": {
        probabilities: {
          "39": 0.96,
          "20": 0.02,
          "32": 0.01,
          "35": 0.01
        },
        confidence: 0.95
      }
    },
    usage: {
      root: { inputTokens: 593, outputTokens: 80 },
      level2: { inputTokens: 1158, outputTokens: 315 }
    }
  },
  "MERIDIAN-GROUP": {
    division: {
      probabilities: {
        "D": 1
      },
      confidence: 1
    },
    groups: {
      "D": {
        probabilities: {
          "37": 0.62,
          "35": 0.3,
          "34": 0.06,
          "33": 0.01,
          "39": 0.01
        },
        confidence: 0.59
      },
      "C": {
        probabilities: {
          "16": 0.53,
          "17": 0.41,
          "15": 0.06
        },
        confidence: 0.3
      },
      "B": {
        probabilities: {
          "10": 0.66,
          "14": 0.23,
          "13": 0.1,
          "12": 0.01
        },
        confidence: 0.54
      }
    },
    usage: {
      root: { inputTokens: 591, outputTokens: 80 },
      level2: { inputTokens: 979, outputTokens: 243 }
    }
  },
  "CASCADE-MILLS": {
    division: {
      probabilities: {
        "A": 0.64,
        "D": 0.36
      },
      confidence: 0.59
    },
    groups: {
      "A": {
        probabilities: {
          "08": 1
        },
        confidence: 1
      },
      "D": {
        probabilities: {
          "24": 1
        },
        confidence: 1
      },
      "C": {
        probabilities: {
          "15": 0.47,
          "17": 0.36,
          "16": 0.17
        },
        confidence: 0.2
      }
    },
    usage: {
      root: { inputTokens: 596, outputTokens: 80 },
      level2: { inputTokens: 995, outputTokens: 243 }
    }
  },
  "ORCHARD-HOLDINGS": {
    division: {
      probabilities: {
        "H": 0.97,
        "I": 0.03
      },
      confidence: 0.95
    },
    groups: {
      "H": {
        probabilities: {
          "67": 1
        },
        confidence: 1
      },
      "I": {
        probabilities: {
          "87": 0.9,
          "73": 0.08,
          "70": 0.01,
          "72": 0.01
        },
        confidence: 0.89
      },
      "C": {
        probabilities: {
          "15": 0.64,
          "17": 0.2,
          "16": 0.16
        },
        confidence: 0.45
      }
    },
    usage: {
      root: { inputTokens: 613, outputTokens: 80 },
      level2: { inputTokens: 912, outputTokens: 203 }
    }
  },
  "VERITAS-LABS": {
    division: {
      probabilities: {
        "I": 0.93,
        "D": 0.06999999999999999
      },
      confidence: 0.91
    },
    groups: {
      "I": {
        probabilities: {
          "87": 0.87,
          "80": 0.12,
          "73": 0.01
        },
        confidence: 0.86
      },
      "D": {
        probabilities: {
          "28": 0.55,
          "38": 0.31,
          "39": 0.14
        },
        confidence: 0.51
      },
      "H": {
        probabilities: {
          "67": 0.93,
          "65": 0.04,
          "62": 0.01,
          "63": 0.01,
          "64": 0.01
        },
        confidence: 0.9
      }
    },
    usage: {
      root: { inputTokens: 593, outputTokens: 80 },
      level2: { inputTokens: 1158, outputTokens: 315 }
    }
  },
  "TIDEWATER-FOODS": {
    division: {
      probabilities: {
        "A": 0.92,
        "D": 0.08
      },
      confidence: 0.91
    },
    groups: {
      "A": {
        probabilities: {
          "01": 1
        },
        confidence: 1
      },
      "D": {
        probabilities: {
          "20": 1
        },
        confidence: 1
      },
      "F": {
        probabilities: {
          "51": 1
        },
        confidence: 1
      }
    },
    usage: {
      root: { inputTokens: 601, outputTokens: 80 },
      level2: { inputTokens: 986, outputTokens: 235 }
    }
  },
  "ARGENT-DIGITAL": {
    division: {
      probabilities: {
        "I": 0.53,
        "H": 0.45,
        "E": 0.02
      },
      confidence: 0.47
    },
    groups: {
      "I": {
        probabilities: {
          "73": 1
        },
        confidence: 0.99
      },
      "H": {
        probabilities: {
          "64": 1
        },
        confidence: 1
      },
      "E": {
        probabilities: {
          "48": 1
        },
        confidence: 0.99
      }
    },
    usage: {
      root: { inputTokens: 584, outputTokens: 80 },
      level2: { inputTokens: 942, outputTokens: 227 }
    }
  }
}

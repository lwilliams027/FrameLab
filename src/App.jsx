/**
 * MVSI — MultiVersus Combo Intelligence
 * 
 * A comprehensive Single Page Application for cataloging, comparing,
 * and visualizing character combos in MultiVersus.
 *
 * Architecture:
 *  - Data Model / Zod-style validation (pure JS schema)
 *  - Zustand-style state via React Context + useReducer
 *  - Tabbed UI: Dashboard | Combo Builder | Analytics | Import/Export
 *  - Recharts for damage comparison bar chart
 *  - React Flow-style DAG flowchart (custom SVG renderer)
 *  - Toast notifications for validation feedback
 */

import { useState, useReducer, useContext, createContext, useCallback, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { FrameDataTab } from "./FrameDataTab.jsx";
import { parseAsset as parseFrameDataAsset } from "./frameDataParser.js";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, CartesianGrid, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Cell
} from "recharts";

// ============================================================
// § 1 — TYPE SYSTEM & SCHEMA VALIDATION
// ============================================================

/** Enum-like constants for all standardised game inputs */
const ENUM = {
  ButtonInput:    ["Attack", "Special", "Jump", "Dodge", "Grab", "Throw"],
  InputDirection: ["Neutral", "Forward", "Up", "Down", "Up-Forward", "Down-Forward"],
  MoveType:       ["Grounded", "Aerial", "Projectile", "Status", "Grab", "Throw"],
  DodgeDirection: ["Neutral", "Forward", "Up", "Down", "Up-Forward", "Down-Forward", "Back", "Up-Back"],
  DIDirection:    ["None", "In", "Out", "Up", "Down"],
  ThrowDirection: ["Forward", "Back"], // used when ButtonInput === "Throw"
  Characters:     [
    // Looney Tunes
    "Bugs Bunny", "Taz", "Marvin the Martian",
    // DC
    "Batman", "Superman", "Wonder Woman", "Harley Quinn", "Joker",
    "Black Adam", "Nubia", "Raven",
    // Scooby-Doo
    "Shaggy", "Velma",
    // Adventure Time
    "Finn", "Jake",
    // Game of Thrones
    "Arya Stark",
    // Steven Universe
    "Steven Universe", "Garnet",
    // Space Jam / Sports
    "LeBron James",
    // The Iron Giant
    "Iron Giant",
    // Rick and Morty
    "Rick", "Morty",
    // Tom and Jerry
    "Tom and Jerry",
    // Reindog (original)
    "Reindog",
    // Adventure Time
    "Banana Guard",
    // Horror
    "Jason Voorhees",
    // Gremlins
    "Gizmo", "Stripe",
    // The Matrix
    "Agent Smith",
    // Beetlejuice
    "Beetlejuice",
    // Samurai Jack
    "Samurai Jack",
    // Powerpuff Girls
    "Powerpuff Girls",
    // Upcoming
    "Marceline",
  ],
};

/**
 * Validate a single Move object.
 * Returns { valid: true } or { valid: false, errors: string[] }
 */
function validateMove(move, index) {
  const errors = [];
  const label = `Move #${index + 1}`;
  if (!ENUM.ButtonInput.includes(move.buttonInput))
    errors.push(`${label}: Invalid buttonInput "${move.buttonInput}"`);
  if (!ENUM.InputDirection.includes(move.inputDirection))
    errors.push(`${label}: Invalid inputDirection`);
  if (!ENUM.MoveType.includes(move.moveType))
    errors.push(`${label}: Invalid moveType`);
  if (move.buttonInput === "Dodge" && !ENUM.DodgeDirection.includes(move.dodgeDirection))
    errors.push(`${label}: Dodge move requires valid dodgeDirection`);
  if (move.buttonInput === "Throw" && move.throwDirection && !ENUM.ThrowDirection.includes(move.throwDirection))
    errors.push(`${label}: Invalid throwDirection`);
  if (!ENUM.DIDirection.includes(move.diDirection))
    errors.push(`${label}: Invalid diDirection`);
  if (typeof move.killConfirm !== "boolean")
    errors.push(`${label}: killConfirm must be boolean`);
  return errors;
}

/**
 * Full combo schema validation.
 * Used both for new entries and for JSON import.
 */
function validateCombo(combo) {
  const errors = [];
  if (!combo.id || typeof combo.id !== "string")
    errors.push("Combo must have a string id");
  if (!ENUM.Characters.includes(combo.character))
    errors.push(`Unknown character: "${combo.character}"`);
  if (!Array.isArray(combo.sequence) || combo.sequence.length === 0)
    errors.push("Combo must have at least one move in sequence");
  else
    combo.sequence.forEach((m, i) => errors.push(...validateMove(m, i)));
  if (typeof combo.totalDamage !== "number" || combo.totalDamage < 0)
    errors.push("totalDamage must be a non-negative number");
  if (typeof combo.startPercent !== "number")
    errors.push("startPercent must be a number");
  if (typeof combo.endPercent !== "number")
    errors.push("endPercent must be a number");
  if (typeof combo.killConfirm !== "boolean")
    errors.push("Top-level killConfirm must be boolean");
  return errors;
}

/** Validate an entire imported database object */
function validateImport(data) {
  if (!data || typeof data !== "object") return ["Root must be an object"];
  if (!Array.isArray(data.combos)) return ["Root must contain a 'combos' array"];
  const errors = [];
  data.combos.forEach((combo, i) => {
    const errs = validateCombo(combo);
    errs.forEach(e => errors.push(`[Combo ${i}] ${e}`));
  });
  return errors;
}

// ============================================================
// § 2 — SAMPLE DATA
// ============================================================

const SAMPLE_COMBOS = [
  // ── Bugs Bunny ──
  {
    id: "c1", character: "Bugs Bunny", totalDamage: 38, startPercent: 0, endPercent: 60,
    killConfirm: false, notes: "Basic bread-and-butter from neutral",
    sequence: [
      { id: "m1", buttonInput: "Attack", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Neutral Attack" },
      { id: "m2", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Forward Attack" },
      { id: "m3", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: false, label: "Up Air" },
    ]
  },
  {
    id: "c2", character: "Bugs Bunny", totalDamage: 62, startPercent: 80, endPercent: 999,
    killConfirm: true, notes: "Kill confirm from ledge trap — DI out loses to Up Air",
    sequence: [
      { id: "m4", buttonInput: "Special", inputDirection: "Down", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Down Special" },
      { id: "m5", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Up Air Kill" },
    ]
  },
  // ── Batman ──
  {
    id: "c3", character: "Batman", totalDamage: 45, startPercent: 20, endPercent: 80,
    killConfirm: false, notes: "Side-B conversion into aerial",
    sequence: [
      { id: "m6", buttonInput: "Special", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Side Special" },
      { id: "m7", buttonInput: "Attack", inputDirection: "Neutral", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Neutral Air" },
      { id: "m8", buttonInput: "Attack", inputDirection: "Down", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Down Air" },
    ]
  },
  {
    id: "c3b", character: "Batman", totalDamage: 58, startPercent: 90, endPercent: 999,
    killConfirm: true, notes: "Batarang into Up Air kill confirm",
    sequence: [
      { id: "m6b", buttonInput: "Special", inputDirection: "Neutral", moveType: "Projectile", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Batarang" },
      { id: "m6c", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Forward Tilt" },
      { id: "m6d", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Up Air Kill" },
    ]
  },
  // ── Shaggy ──
  {
    id: "c4", character: "Shaggy", totalDamage: 55, startPercent: 60, endPercent: 999,
    killConfirm: true, notes: "Ultra Instinct kill route",
    sequence: [
      { id: "m9", buttonInput: "Special", inputDirection: "Up", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Up Special" },
      { id: "m10", buttonInput: "Attack", inputDirection: "Forward", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Forward Air" },
    ]
  },
  {
    id: "c4b", character: "Shaggy", totalDamage: 42, startPercent: 0, endPercent: 70,
    killConfirm: false, notes: "Down tilt loop into up smash",
    sequence: [
      { id: "m9b", buttonInput: "Attack", inputDirection: "Down", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Down Tilt" },
      { id: "m9c", buttonInput: "Attack", inputDirection: "Down", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Down Tilt" },
      { id: "m9d", buttonInput: "Attack", inputDirection: "Up", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Up Smash" },
    ]
  },
  // ── Wonder Woman ──
  {
    id: "c5", character: "Wonder Woman", totalDamage: 40, startPercent: 0, endPercent: 50,
    killConfirm: false, notes: "Shield loop starter",
    sequence: [
      { id: "m11", buttonInput: "Attack", inputDirection: "Down", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Down Tilt" },
      { id: "m12", buttonInput: "Special", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Neutral Special" },
      { id: "m13", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Up", killConfirm: false, label: "Up Air" },
    ]
  },
  {
    id: "c5b", character: "Wonder Woman", totalDamage: 65, startPercent: 100, endPercent: 999,
    killConfirm: true, notes: "Grab into forward throw kill at ledge",
    sequence: [
      { id: "m13b", buttonInput: "Grab", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Grab" },
      { id: "m13c", buttonInput: "Throw", inputDirection: "Forward", moveType: "Throw", dodgeDirection: "Neutral", diDirection: "None", killConfirm: true, throwDirection: "Forward", label: "Forward Throw" },
    ]
  },
  // ── Harley Quinn ──
  {
    id: "c6", character: "Harley Quinn", totalDamage: 48, startPercent: 0, endPercent: 70,
    killConfirm: false, notes: "Confetti pop combo",
    sequence: [
      { id: "m14", buttonInput: "Attack", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Jab" },
      { id: "m15", buttonInput: "Special", inputDirection: "Down", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Down Special" },
      { id: "m16", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: false, label: "Up Air" },
    ]
  },
  {
    id: "c6b", character: "Harley Quinn", totalDamage: 70, startPercent: 80, endPercent: 999,
    killConfirm: true, notes: "Mallet kill confirm off platform",
    sequence: [
      { id: "m16b", buttonInput: "Special", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Neutral Special" },
      { id: "m16c", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: false, label: "Forward Smash" },
      { id: "m16d", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Up Air Kill" },
    ]
  },
  // ── Taz ──
  {
    id: "c7", character: "Taz", totalDamage: 52, startPercent: 10, endPercent: 80,
    killConfirm: false, notes: "Spin into aerial followup",
    sequence: [
      { id: "m17", buttonInput: "Special", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Neutral Special Spin" },
      { id: "m18", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Up Air" },
      { id: "m19", buttonInput: "Attack", inputDirection: "Neutral", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Neutral Air" },
    ]
  },
  {
    id: "c7b", character: "Taz", totalDamage: 60, startPercent: 70, endPercent: 999,
    killConfirm: true, notes: "Eat grab into offstage spike",
    sequence: [
      { id: "m19b", buttonInput: "Grab", inputDirection: "Neutral", moveType: "Grab", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Eat Grab" },
      { id: "m19c", buttonInput: "Attack", inputDirection: "Down", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "None", killConfirm: true, label: "Down Air Spike" },
    ]
  },
  // ── Superman ──
  {
    id: "c8", character: "Superman", totalDamage: 44, startPercent: 0, endPercent: 60,
    killConfirm: false, notes: "Laser into ground combo",
    sequence: [
      { id: "m20", buttonInput: "Special", inputDirection: "Neutral", moveType: "Projectile", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Eye Laser" },
      { id: "m21", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Forward Tilt" },
      { id: "m22", buttonInput: "Attack", inputDirection: "Up", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Up Smash" },
    ]
  },
  {
    id: "c8b", character: "Superman", totalDamage: 72, startPercent: 90, endPercent: 999,
    killConfirm: true, notes: "Grab into back throw off stage for early stock",
    sequence: [
      { id: "m22b", buttonInput: "Grab", inputDirection: "Neutral", moveType: "Grab", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Grab" },
      { id: "m22c", buttonInput: "Throw", inputDirection: "Forward", moveType: "Throw", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, throwDirection: "Back", label: "Back Throw" },
      { id: "m22d", buttonInput: "Attack", inputDirection: "Forward", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Forward Air Kill" },
    ]
  },
  // ── Arya Stark ──
  {
    id: "c9", character: "Arya Stark", totalDamage: 50, startPercent: 30, endPercent: 90,
    killConfirm: false, notes: "Face swap into aerial extension",
    sequence: [
      { id: "m23", buttonInput: "Special", inputDirection: "Down", moveType: "Status", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Face Swap" },
      { id: "m24", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Forward Attack" },
      { id: "m25", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: false, label: "Up Air" },
    ]
  },
  {
    id: "c9b", character: "Arya Stark", totalDamage: 68, startPercent: 85, endPercent: 999,
    killConfirm: true, notes: "Needle throw wall kill setup",
    sequence: [
      { id: "m25b", buttonInput: "Special", inputDirection: "Neutral", moveType: "Projectile", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Needle Throw" },
      { id: "m25c", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: false, label: "Forward Smash" },
      { id: "m25d", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "None", killConfirm: true, label: "Up Air Kill" },
    ]
  },
  // ── Iron Giant ──
  {
    id: "c10", character: "Iron Giant", totalDamage: 35, startPercent: 0, endPercent: 50,
    killConfirm: false, notes: "Slow but devastating ground string",
    sequence: [
      { id: "m26", buttonInput: "Attack", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Jab" },
      { id: "m27", buttonInput: "Attack", inputDirection: "Down", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Down Tilt" },
      { id: "m28", buttonInput: "Attack", inputDirection: "Up", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Up Smash" },
    ]
  },
  {
    id: "c10b", character: "Iron Giant", totalDamage: 80, startPercent: 70, endPercent: 999,
    killConfirm: true, notes: "Grab into cannon blast kill",
    sequence: [
      { id: "m28b", buttonInput: "Grab", inputDirection: "Neutral", moveType: "Grab", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Grab" },
      { id: "m28c", buttonInput: "Special", inputDirection: "Neutral", moveType: "Projectile", dodgeDirection: "Neutral", diDirection: "None", killConfirm: true, label: "Cannon Blast" },
    ]
  },
  // ── Rick ──
  {
    id: "c11", character: "Rick", totalDamage: 46, startPercent: 0, endPercent: 65,
    killConfirm: false, notes: "Portal gun setup into combo",
    sequence: [
      { id: "m29", buttonInput: "Special", inputDirection: "Down", moveType: "Projectile", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Portal Gun" },
      { id: "m30", buttonInput: "Attack", inputDirection: "Neutral", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Neutral Air" },
      { id: "m31", buttonInput: "Attack", inputDirection: "Forward", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: false, label: "Forward Air" },
    ]
  },
  {
    id: "c11b", character: "Rick", totalDamage: 63, startPercent: 75, endPercent: 999,
    killConfirm: true, notes: "Freeze ray into forward smash kill",
    sequence: [
      { id: "m31b", buttonInput: "Special", inputDirection: "Forward", moveType: "Projectile", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Freeze Ray" },
      { id: "m31c", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Forward Smash Kill" },
    ]
  },
  // ── Finn ──
  {
    id: "c12", character: "Finn", totalDamage: 43, startPercent: 10, endPercent: 75,
    killConfirm: false, notes: "Backpack item toss combo",
    sequence: [
      { id: "m32", buttonInput: "Special", inputDirection: "Down", moveType: "Status", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Backpack Toss" },
      { id: "m33", buttonInput: "Attack", inputDirection: "Forward", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Forward Tilt" },
      { id: "m34", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "In", killConfirm: false, label: "Up Air" },
    ]
  },
  {
    id: "c12b", character: "Finn", totalDamage: 57, startPercent: 80, endPercent: 999,
    killConfirm: true, notes: "Golden sword kill confirm",
    sequence: [
      { id: "m34b", buttonInput: "Special", inputDirection: "Neutral", moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None", killConfirm: false, label: "Golden Sword" },
      { id: "m34c", buttonInput: "Attack", inputDirection: "Up", moveType: "Aerial", dodgeDirection: "Neutral", diDirection: "Out", killConfirm: true, label: "Up Air Kill" },
    ]
  },
];

// ============================================================
// § 3 — GLOBAL STATE (Context + useReducer)
// ============================================================

export const AppContext = createContext(null);

const initialState = {
  combos: SAMPLE_COMBOS,
  toasts: [],
  activeTab: "dashboard",
  selectedCharacter: null,
  selectedComboId: null,
  // Frame data: shared across the Frame Data tab and Import/Export tab
  frameData: {
    moves: {},   // moveId -> parsed move object
    media: {},   // moveId -> { url, type, name, persisted, isBlob }
    stats: {},   // moveId -> manual stats object
    initialized: false,
  },
};

function appReducer(state, action) {
  switch (action.type) {
    case "ADD_COMBO":
      return { ...state, combos: [...state.combos, action.payload] };
    case "DELETE_COMBO":
      return { ...state, combos: state.combos.filter(c => c.id !== action.payload) };
    case "UPDATE_COMBO":
      return { ...state, combos: state.combos.map(c => c.id === action.payload.id ? action.payload : c) };
    case "IMPORT_COMBOS":
      return { ...state, combos: [...state.combos, ...action.payload] };
    case "REPLACE_COMBOS":
      return { ...state, combos: action.payload };
    case "SET_TAB":
      return { ...state, activeTab: action.payload };
    case "SELECT_CHARACTER":
      return { ...state, selectedCharacter: action.payload };
    case "SELECT_COMBO":
      return { ...state, selectedComboId: action.payload };
    case "ADD_TOAST":
      return { ...state, toasts: [...state.toasts, { id: Date.now() + Math.random(), ...action.payload }] };
    case "REMOVE_TOAST":
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };

    // ── Frame Data ──
    case "FRAMEDATA_INIT": {
      // payload: { moves, media, stats }
      return {
        ...state,
        frameData: {
          moves: action.payload.moves || {},
          media: action.payload.media || {},
          stats: action.payload.stats || {},
          initialized: true,
        },
      };
    }
    case "FRAMEDATA_ADD_MOVE": {
      // payload: { move, media?, stats? }
      const { move, media, stats } = action.payload;
      return {
        ...state,
        frameData: {
          ...state.frameData,
          moves: { ...state.frameData.moves, [move.id]: move },
          media: media ? { ...state.frameData.media, [move.id]: media } : state.frameData.media,
          stats: stats ? { ...state.frameData.stats, [move.id]: stats } : state.frameData.stats,
          initialized: true,
        },
      };
    }
    case "FRAMEDATA_REMOVE_MOVE": {
      // payload: moveId
      const id = action.payload;
      const { [id]: _m, ...moves } = state.frameData.moves;
      const { [id]: _md, ...media } = state.frameData.media;
      const { [id]: _s, ...stats } = state.frameData.stats;
      return { ...state, frameData: { ...state.frameData, moves, media, stats } };
    }
    case "FRAMEDATA_ATTACH_MEDIA": {
      // payload: { moveId, media }
      return {
        ...state,
        frameData: {
          ...state.frameData,
          media: { ...state.frameData.media, [action.payload.moveId]: action.payload.media },
        },
      };
    }
    case "FRAMEDATA_DETACH_MEDIA": {
      // payload: moveId
      const { [action.payload]: _, ...media } = state.frameData.media;
      return { ...state, frameData: { ...state.frameData, media } };
    }
    case "FRAMEDATA_ATTACH_STATS": {
      return {
        ...state,
        frameData: {
          ...state.frameData,
          stats: { ...state.frameData.stats, [action.payload.moveId]: action.payload.stats },
        },
      };
    }
    case "FRAMEDATA_REPLACE_ALL": {
      // payload: { moves, media, stats }
      return {
        ...state,
        frameData: {
          moves: action.payload.moves || {},
          media: action.payload.media || {},
          stats: action.payload.stats || {},
          initialized: true,
        },
      };
    }

    default:
      return state;
  }
}

function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const toast = useCallback((message, type = "info") => {
    dispatch({ type: "ADD_TOAST", payload: { message, kind: type } });
  }, []);
  return (
    <AppContext.Provider value={{ state, dispatch, toast }}>
      {children}
    </AppContext.Provider>
  );
}

function useApp() { return useContext(AppContext); }

// ============================================================
// § 4 — UTILITIES
// ============================================================

function nanoid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// § 5 — DESIGN TOKENS & GLOBAL STYLES
// ============================================================

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Exo+2:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg0: #07080d;
    --bg1: #0d0f18;
    --bg2: #131620;
    --bg3: #1a1d2e;
    --bg4: #222538;
    --line: rgba(99,102,241,0.15);
    --accent: #6366f1;
    --accent2: #818cf8;
    --accent3: #a5b4fc;
    --gold: #f59e0b;
    --red: #ef4444;
    --green: #22c55e;
    --cyan: #06b6d4;
    --text0: #f1f5f9;
    --text1: #cbd5e1;
    --text2: #94a3b8;
    --text3: #475569;
    --r: 8px;
    --r2: 12px;
    --font-display: 'Rajdhani', sans-serif;
    --font-body: 'Exo 2', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  html, body, #root { height: 100%; background: var(--bg0); color: var(--text0); font-family: var(--font-body); }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg1); }
  ::-webkit-scrollbar-thumb { background: var(--bg4); border-radius: 3px; }

  button { cursor: pointer; border: none; outline: none; font-family: var(--font-body); }
  input, select, textarea { font-family: var(--font-body); outline: none; border: none; }

  /* ── Animated grid background ── */
  .grid-bg {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image:
      linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  /* ── App shell ── */
  .app { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }

  /* ── Header ── */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; height: 60px;
    background: rgba(13,15,24,0.9); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
    position: sticky; top: 0; z-index: 100;
  }
  .logo { font-family: var(--font-display); font-size: 26px; font-weight: 700; letter-spacing: 2px; color: var(--accent3); }
  .logo span { color: var(--gold); }
  .logo sub { font-size: 11px; color: var(--text3); letter-spacing: 1px; text-transform: uppercase; margin-left: 8px; vertical-align: middle; }

  /* ── Nav tabs ── */
  .tabs { display: flex; gap: 4px; }
  .tab-btn {
    padding: 6px 18px; border-radius: var(--r); font-family: var(--font-display);
    font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
    color: var(--text2); background: transparent;
    transition: all 0.2s ease;
  }
  .tab-btn:hover { color: var(--text0); background: var(--bg3); }
  .tab-btn.active { color: var(--accent3); background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3); }

  /* ── Main content ── */
  .content { flex: 1; padding: 24px; max-width: 1400px; width: 100%; margin: 0 auto; }

  /* ── Cards ── */
  .card {
    background: var(--bg2); border: 1px solid var(--line);
    border-radius: var(--r2); padding: 20px;
    transition: border-color 0.2s;
  }
  .card:hover { border-color: rgba(99,102,241,0.3); }
  .card-title {
    font-family: var(--font-display); font-size: 13px; font-weight: 600;
    letter-spacing: 2px; text-transform: uppercase; color: var(--text2);
    margin-bottom: 16px;
  }

  /* ── Stat tiles ── */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat-tile {
    background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r2);
    padding: 20px; position: relative; overflow: hidden;
  }
  .stat-tile::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(99,102,241,0.08) 0%, transparent 60%);
  }
  .stat-value { font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--accent3); line-height: 1; }
  .stat-label { font-size: 12px; color: var(--text2); letter-spacing: 1px; text-transform: uppercase; margin-top: 6px; }
  .stat-sub { font-size: 11px; color: var(--text3); margin-top: 4px; }

  /* ── Combo list ── */
  .combo-list { display: flex; flex-direction: column; gap: 10px; }
  .combo-row {
    display: flex; align-items: center; gap: 12px;
    background: var(--bg3); border: 1px solid var(--line); border-radius: var(--r);
    padding: 12px 16px; cursor: pointer; transition: all 0.2s;
  }
  .combo-row:hover { border-color: rgba(99,102,241,0.4); background: var(--bg4); }
  .combo-row.selected { border-color: var(--accent); background: rgba(99,102,241,0.1); }
  .combo-char { font-family: var(--font-display); font-size: 16px; font-weight: 700; min-width: 120px; }
  .combo-dmg { font-family: var(--font-mono); font-size: 18px; font-weight: 500; color: var(--gold); min-width: 60px; }
  .combo-seq { font-size: 12px; color: var(--text2); flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .badge {
    padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.5px; text-transform: uppercase; white-space: nowrap;
  }
  .badge-kill { background: rgba(239,68,68,0.2); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }
  .badge-combo { background: rgba(99,102,241,0.15); color: var(--accent3); border: 1px solid rgba(99,102,241,0.2); }
  .badge-pct { background: rgba(6,182,212,0.1); color: var(--cyan); border: 1px solid rgba(6,182,212,0.2); }
  .icon-btn {
    width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
    color: var(--text3); background: transparent; font-size: 14px; transition: all 0.2s;
  }
  .icon-btn:hover { background: rgba(239,68,68,0.15); color: var(--red); }

  /* ── Form elements ── */
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 11px; color: var(--text2); letter-spacing: 1px; text-transform: uppercase; font-weight: 600; }
  .field select, .field input, .field textarea {
    background: var(--bg3); border: 1px solid var(--bg4); border-radius: var(--r);
    padding: 9px 12px; color: var(--text0); font-size: 14px;
    transition: border-color 0.2s;
  }
  .field select:focus, .field input:focus, .field textarea:focus { border-color: var(--accent); }
  .field select option { background: var(--bg3); }
  .field textarea { resize: vertical; min-height: 70px; }

  /* ── Buttons ── */
  .btn {
    padding: 9px 18px; border-radius: var(--r); font-family: var(--font-display);
    font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
    transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
  }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent2); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(99,102,241,0.4); }
  .btn-ghost { background: transparent; color: var(--text1); border: 1px solid var(--bg4); }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent3); }
  .btn-danger { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.2); }
  .btn-danger:hover { background: rgba(239,68,68,0.25); }
  .btn-success { background: rgba(34,197,94,0.15); color: var(--green); border: 1px solid rgba(34,197,94,0.2); }
  .btn-success:hover { background: rgba(34,197,94,0.25); }
  .btn-sm { padding: 5px 12px; font-size: 12px; }

  /* ── Section divider ── */
  .divider { border: none; border-top: 1px solid var(--line); margin: 20px 0; }

  /* ── Move chips in sequence ── */
  .seq-strip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
  .move-chip {
    display: flex; align-items: center; gap: 4px; padding: 4px 10px;
    background: var(--bg4); border: 1px solid var(--line); border-radius: 20px;
    font-size: 12px; font-family: var(--font-mono);
  }
  .move-chip .dir { color: var(--cyan); font-weight: 600; }
  .move-chip .btn-i { color: var(--accent3); font-weight: 700; }
  .arrow { color: var(--text3); font-size: 10px; align-self: center; }

  /* ── Flowchart ── */
  .flowchart-wrap {
    overflow: auto; background: var(--bg1); border-radius: var(--r);
    border: 1px solid var(--line); position: relative; cursor: grab;
    user-select: none;
  }
  .flowchart-wrap:active { cursor: grabbing; }
  .flowchart-wrap.empty { min-height: 160px; display:flex; align-items:center; justify-content:center; }
  .fc-svg { display: block; }
  .fc-node { cursor: pointer; transition: filter 0.15s; }
  .fc-node:hover { filter: brightness(1.3); }
  .fc-legend { display:flex; gap:14px; flex-wrap:wrap; margin-top:10px; }
  .fc-legend-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--text2); }
  .fc-legend-dot { width:10px; height:10px; border-radius:2px; flex-shrink:0; }
  .fc-controls { display:flex; gap:6px; margin-bottom:8px; }
  /* Flowcharts tab */
  .fc-tab-grid { display:grid; grid-template-columns: 280px 1fr; gap:20px; }
  @media(max-width:900px){ .fc-tab-grid { grid-template-columns:1fr; } }
  .fc-combo-item {
    padding:10px 14px; border-radius:var(--r); border:1px solid var(--line);
    background:var(--bg3); cursor:pointer; transition:all 0.15s;
  }
  .fc-combo-item:hover { border-color:rgba(99,102,241,0.4); background:var(--bg4); }
  .fc-combo-item.active { border-color:var(--accent); background:rgba(99,102,241,0.1); }
  .fc-tooltip {
    position:absolute; pointer-events:none; z-index:50;
    background:var(--bg0); border:1px solid rgba(99,102,241,0.4);
    border-radius:var(--r); padding:10px 14px; font-size:12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6); min-width:160px;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }

  /* ── Analytics grid ── */
  .analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media(max-width: 900px) { .analytics-grid { grid-template-columns: 1fr; } }

  /* ── Import/Export ── */
  .dropzone {
    border: 2px dashed var(--bg4); border-radius: var(--r2);
    padding: 48px 24px; text-align: center; cursor: pointer;
    transition: all 0.2s; color: var(--text2);
  }
  .dropzone:hover, .dropzone.drag { border-color: var(--accent); color: var(--text0); background: rgba(99,102,241,0.05); }
  .dropzone-icon { font-size: 40px; margin-bottom: 12px; }
  .dropzone-text { font-family: var(--font-display); font-size: 18px; font-weight: 600; }
  .dropzone-sub { font-size: 13px; color: var(--text3); margin-top: 6px; }

  /* ── Toasts ── */
  .toast-stack { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
  .toast {
    padding: 12px 18px; border-radius: var(--r); border: 1px solid; min-width: 260px;
    font-size: 13px; font-weight: 500; animation: slideUp 0.3s ease; pointer-events: auto;
  }
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
  .toast-success { background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.3); color: #86efac; }
  .toast-error { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); color: #fca5a5; }
  .toast-info { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.3); color: var(--accent3); }
  .toast-warn { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.3); color: #fcd34d; }

  /* ── Two-col layout ── */
  .two-col { display: grid; grid-template-columns: 340px 1fr; gap: 20px; }
  @media(max-width: 900px) { .two-col { grid-template-columns: 1fr; } }

  /* ── Character filter bar ── */
  .char-filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .char-pill {
    padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--bg4); color: var(--text2); background: transparent;
    transition: all 0.15s; cursor: pointer;
  }
  .char-pill:hover { border-color: var(--accent); color: var(--accent3); }
  .char-pill.active { background: rgba(99,102,241,0.2); border-color: var(--accent); color: var(--accent3); }

  /* ── Page title ── */
  .page-title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: 1px; margin-bottom: 20px; }
  .page-title span { color: var(--accent3); }

  /* ── Move builder row ── */
  .move-row {
    background: var(--bg3); border: 1px solid var(--line); border-radius: var(--r);
    padding: 14px; position: relative;
  }
  .move-row-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .move-num { font-family: var(--font-mono); font-size: 12px; color: var(--accent); background: rgba(99,102,241,0.15); padding: 2px 8px; border-radius: 4px; }

  /* ── Toggle switch ── */
  .toggle-wrap { display: flex; align-items: center; gap: 8px; }
  .toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-track { position: absolute; inset: 0; background: var(--bg4); border-radius: 20px; transition: background 0.2s; }
  .toggle input:checked ~ .toggle-track { background: var(--accent); }
  .toggle-thumb { position: absolute; width: 14px; height: 14px; background: white; border-radius: 50%; top: 3px; left: 3px; transition: transform 0.2s; }
  .toggle input:checked ~ .toggle-thumb { transform: translateX(16px); }

  /* ── Scrollable list ── */
  .scroll-list { max-height: 500px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
  
  /* ── Empty state ── */
  .empty { text-align: center; padding: 48px; color: var(--text3); }
  .empty-icon { font-size: 48px; margin-bottom: 12px; }
  .empty-text { font-family: var(--font-display); font-size: 20px; }
  .empty-sub { font-size: 13px; margin-top: 6px; }

  /* ── Compare table ── */
  .compare-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .compare-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); font-family: var(--font-display); font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text2); }
  .compare-table td { padding: 10px 12px; border-bottom: 1px solid rgba(99,102,241,0.05); }
  .compare-table tr:hover td { background: rgba(99,102,241,0.05); }

  /* ── Glow accent ── */
  .glow { text-shadow: 0 0 20px rgba(99,102,241,0.6); }

  /* ── Progress bar ── */
  .prog-bar-wrap { height: 6px; background: var(--bg4); border-radius: 3px; overflow: hidden; }
  .prog-bar { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--accent), var(--cyan)); transition: width 0.3s; }
`;

// ============================================================
// § 6 — TOAST SYSTEM
// ============================================================

function ToastStack() {
  const { state, dispatch } = useApp();
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const latest = state.toasts[state.toasts.length - 1];
    const timer = setTimeout(() => dispatch({ type: "REMOVE_TOAST", payload: latest.id }), 4000);
    return () => clearTimeout(timer);
  }, [state.toasts]);

  return (
    <div className="toast-stack">
      {state.toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}
          onClick={() => dispatch({ type: "REMOVE_TOAST", payload: t.id })}>
          {t.kind === "success" && "✓ "}
          {t.kind === "error" && "✗ "}
          {t.kind === "warn" && "⚠ "}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// § 7 — COMBO FLOWCHART (Rich Interactive SVG DAG)
// ============================================================

/** Per-input-type colour palette */
const NODE_COLORS = {
  Attack:  { stroke: "#6366f1", fill: "#6366f115", glow: "rgba(99,102,241,0.35)"  },
  Special: { stroke: "#f59e0b", fill: "#f59e0b15", glow: "rgba(245,158,11,0.35)"  },
  Jump:    { stroke: "#22c55e", fill: "#22c55e15", glow: "rgba(34,197,94,0.35)"   },
  Dodge:   { stroke: "#06b6d4", fill: "#06b6d415", glow: "rgba(6,182,212,0.35)"   },
  Grab:    { stroke: "#ec4899", fill: "#ec489915", glow: "rgba(236,72,153,0.35)"   },
  Throw:   { stroke: "#a855f7", fill: "#a855f715", glow: "rgba(168,85,247,0.35)"  },
};

/** Direction arrow symbols rendered inside edges */
const DIR_SYMBOL = {
  Neutral: "●", Forward: "▶", Up: "▲", Down: "▼",
  "Up-Forward": "↗", "Down-Forward": "↘", Back: "◀", "Up-Back": "↖",
};

/**
 * Full-featured interactive flowchart:
 *  - Animated entrance (nodes stagger in)
 *  - Hover tooltip with full move details
 *  - DI branch forks: if a move has diDirection != None, a split edge
 *    diverges downward from the main flow, labeled with DI scenario
 *  - Pan (drag) + zoom (buttons / scroll)
 *  - Kill-confirm nodes pulse with red ring
 *  - Legend below chart
 */
function ComboFlowchart({ combo, height = 220 }) {
  if (!combo || !combo.sequence || combo.sequence.length === 0) return (
    <div className="flowchart-wrap empty">
      <span style={{ color: "var(--text3)", fontSize: 13 }}>No moves to display</span>
    </div>
  );

  const { sequence } = combo;

  // Layout constants
  const NODE_W = 136, NODE_H = 64, H_GAP = 72, MARGIN = 28;
  const MAIN_Y = 40;           // y-centre of main row
  const FORK_Y = MAIN_Y + 90; // y-centre of DI branch row

  // Pan / zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const wrapRef = useRef(null);

  // Hover tooltip
  const [tooltip, setTooltip] = useState(null); // { move, x, y }
  const [hoveredIdx, setHoveredIdx] = useState(null);

  // Animated entrance - each node gets a delayed opacity/transform
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 40); return () => clearTimeout(t); }, [combo]);

  // Derived layout
  const nodeX  = i => MARGIN + i * (NODE_W + H_GAP);
  const nodeCX = i => nodeX(i) + NODE_W / 2;

  // Determine which moves have DI forks
  const hasFork = (move) => move.diDirection && move.diDirection !== "None";

  // Calculate total canvas size (add extra height if forks exist)
  const hasForks = sequence.some(hasFork);
  const totalW = sequence.length * NODE_W + (sequence.length - 1) * H_GAP + MARGIN * 2;
  const totalH = hasForks ? FORK_Y + NODE_H + MARGIN + 20 : MAIN_Y + NODE_H + MARGIN + 10;

  // ── Drag handlers ────────────────────────────────────────────
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e) => {
    if (!dragging || !dragStart.current) return;
    setPan({ x: dragStart.current.px + e.clientX - dragStart.current.mx,
              y: dragStart.current.py + e.clientY - dragStart.current.my });
  };
  const onMouseUp = () => { setDragging(false); dragStart.current = null; };
  const onWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.4, z - e.deltaY * 0.001)));
  };

  // Unique defs id to avoid clashes when multiple charts on page
  const defsId = useMemo(() => `fc-${combo.id}`, [combo.id]);

  const colors = (move) => NODE_COLORS[move.buttonInput] || NODE_COLORS.Attack;

  return (
    <div>
      {/* Zoom controls */}
      <div className="fc-controls">
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.min(2, z + 0.15))}>＋ Zoom</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.max(0.4, z - 0.15))}>－ Zoom</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
        <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4, alignSelf: "center" }}>
          Drag to pan · Scroll to zoom
        </span>
      </div>

      {/* SVG canvas */}
      <div
        ref={wrapRef}
        className="flowchart-wrap"
        style={{ height, position: "relative" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <svg
          width={totalW} height={totalH}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "top left",
            transition: dragging ? "none" : "transform 0.1s ease",
            display: "block",
          }}
        >
          <defs>
            {/* Arrow markers per color */}
            {Object.entries(NODE_COLORS).map(([k, c]) => (
              <marker key={k} id={`${defsId}-arrow-${k}`}
                markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L7,3 L0,6 Z" fill={c.stroke} opacity="0.7" />
              </marker>
            ))}
            <marker id={`${defsId}-arrow-fork`}
              markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="#ef4444" opacity="0.7" />
            </marker>
            {/* Glow filters */}
            {Object.entries(NODE_COLORS).map(([k, c]) => (
              <filter key={k} id={`${defsId}-glow-${k}`} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feFlood floodColor={c.stroke} floodOpacity="0.4" result="color" />
                <feComposite in="color" in2="blur" operator="in" result="shadow" />
                <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            ))}
            <filter id={`${defsId}-glow-kill`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feFlood floodColor="#ef4444" floodOpacity="0.5" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="shadow" />
              <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* ── Main-row edges ── */}
          {sequence.slice(0, -1).map((move, i) => {
            const x1 = nodeX(i) + NODE_W, x2 = nodeX(i + 1);
            const y  = MAIN_Y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const col = colors(move).stroke;
            const nextMove = sequence[i + 1];
            const sym = DIR_SYMBOL[nextMove.inputDirection] || "";
            return (
              <g key={`main-edge-${i}`}>
                <path d={`M${x1},${y} C${mid},${y} ${mid},${y} ${x2},${y}`}
                  stroke={col} strokeWidth="1.5" fill="none" opacity="0.6"
                  markerEnd={`url(#${defsId}-arrow-${move.buttonInput})`} />
                {/* Input direction symbol on edge */}
                {sym && (
                  <text x={mid} y={y - 7} textAnchor="middle"
                    fontSize="10" fill={col} fontFamily="JetBrains Mono" opacity="0.8">{sym}</text>
                )}
              </g>
            );
          })}

          {/* ── DI fork edges ── */}
          {sequence.map((move, i) => {
            if (!hasFork(move)) return null;
            const cx  = nodeCX(i);
            const y0  = MAIN_Y + NODE_H;          // bottom of main node
            const y1  = FORK_Y;                   // top of fork node
            const ymid = (y0 + y1) / 2;
            return (
              <g key={`fork-edge-${i}`}>
                {/* Vertical drop */}
                <path d={`M${cx},${y0} C${cx},${ymid} ${cx},${ymid} ${cx},${y1}`}
                  stroke="#ef4444" strokeWidth="1.2" fill="none" strokeDasharray="5 3"
                  markerEnd={`url(#${defsId}-arrow-fork)`} opacity="0.7" />
                {/* DI label on the line */}
                <rect x={cx - 28} y={ymid - 9} width={56} height={16} rx="4"
                  fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.3)" strokeWidth="0.8" />
                <text x={cx} y={ymid + 4} textAnchor="middle"
                  fontSize="9" fill="#ef4444" fontFamily="JetBrains Mono" fontWeight="600">
                  DI {move.diDirection}
                </text>
              </g>
            );
          })}

          {/* ── Main-row nodes ── */}
          {sequence.map((move, i) => {
            const x   = nodeX(i), y = MAIN_Y;
            const col = colors(move);
            const isKill = move.killConfirm;
            const isHov  = hoveredIdx === `m-${i}`;
            const delay  = i * 60;
            return (
              <g key={`main-node-${i}`} className="fc-node"
                style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(8px)",
                         transition: `opacity 0.3s ${delay}ms, transform 0.3s ${delay}ms` }}
                filter={isHov ? `url(#${defsId}-glow-${move.buttonInput})` : isKill ? `url(#${defsId}-glow-kill)` : "none"}
                onMouseEnter={e => { setHoveredIdx(`m-${i}`); setTooltip({ move, x: e.clientX, y: e.clientY }); }}
                onMouseLeave={() => { setHoveredIdx(null); setTooltip(null); }}
              >
                {/* Kill confirm pulse ring */}
                {isKill && (
                  <rect x={x - 4} y={y - 4} width={NODE_W + 8} height={NODE_H + 8} rx="10"
                    fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.6">
                    <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.2s" repeatCount="indefinite" />
                  </rect>
                )}
                {/* Node body */}
                <rect x={x} y={y} width={NODE_W} height={NODE_H} rx="8"
                  fill={isHov ? col.stroke + "28" : col.fill}
                  stroke={isKill ? "#ef4444" : col.stroke} strokeWidth={isKill ? 2 : 1.2} />
                {/* Step number badge */}
                <rect x={x + 4} y={y + 4} width={18} height={14} rx="3" fill={col.stroke + "30"} />
                <text x={x + 13} y={y + 14} textAnchor="middle"
                  fontSize="8" fill={col.stroke} fontFamily="JetBrains Mono" fontWeight="700">{i + 1}</text>
                {/* Input label */}
                <text x={x + NODE_W / 2} y={y + 24} textAnchor="middle"
                  fontSize="11" fill={col.stroke} fontFamily="JetBrains Mono" fontWeight="700">
                  {move.inputDirection !== "Neutral" ? move.inputDirection + " " : ""}{move.buttonInput}
                </text>
                {/* Move label / type */}
                <text x={x + NODE_W / 2} y={y + 38} textAnchor="middle"
                  fontSize="9.5" fill="rgba(203,213,225,0.85)" fontFamily="Exo 2">
                  {move.label || move.moveType}
                </text>
                {/* MoveType tag */}
                <text x={x + NODE_W / 2} y={y + 52} textAnchor="middle"
                  fontSize="8" fill="rgba(148,163,184,0.5)" fontFamily="JetBrains Mono">
                  [{move.moveType}]
                </text>
                {/* Kill badge */}
                {isKill && (
                  <g>
                    <rect x={x + NODE_W - 30} y={y + 3} width={27} height={13} rx="3" fill="rgba(239,68,68,0.25)" />
                    <text x={x + NODE_W - 16} y={y + 13} textAnchor="middle"
                      fontSize="8" fill="#ef4444" fontFamily="Exo 2" fontWeight="700">KILL</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* ── DI fork nodes ── */}
          {sequence.map((move, i) => {
            if (!hasFork(move)) return null;
            const x = nodeX(i), y = FORK_Y;
            // Show what a player *should* do when opponent DIs this direction
            const diLabel = `vs DI ${move.diDirection}`;
            return (
              <g key={`fork-node-${i}`} className="fc-node"
                onMouseEnter={e => setTooltip({ move: { ...move, _isFork: true }, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}>
                <rect x={x} y={y} width={NODE_W} height={NODE_H} rx="8"
                  fill="rgba(239,68,68,0.08)" stroke="#ef4444" strokeWidth="1.2" strokeDasharray="4 2" />
                <text x={x + NODE_W / 2} y={y + 20} textAnchor="middle"
                  fontSize="9" fill="#ef4444" fontFamily="JetBrains Mono" fontWeight="700">
                  {diLabel}
                </text>
                <text x={x + NODE_W / 2} y={y + 34} textAnchor="middle"
                  fontSize="9" fill="rgba(203,213,225,0.6)" fontFamily="Exo 2">
                  Adjust follow-up
                </text>
                <text x={x + NODE_W / 2} y={y + 48} textAnchor="middle"
                  fontSize="8" fill="rgba(148,163,184,0.4)" fontFamily="JetBrains Mono">
                  [DI branch]
                </text>
              </g>
            );
          })}

          {/* ── Horizontal connector: "START" cap ── */}
          <rect x={MARGIN - 6} y={MAIN_Y + NODE_H / 2 - 9} width={38} height={18} rx="4"
            fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" strokeWidth="1" />
          <text x={MARGIN + 13} y={MAIN_Y + NODE_H / 2 + 4} textAnchor="middle"
            fontSize="8" fill="var(--accent3)" fontFamily="JetBrains Mono" fontWeight="700">START</text>
        </svg>

        {/* ── Hover Tooltip (portal-style absolute inside wrap) ── */}
        {tooltip && (
          <div className="fc-tooltip" style={{ top: 10, right: 10 }}>
            {tooltip.move._isFork ? (
              <>
                <div style={{ color: "#ef4444", fontWeight: 700, marginBottom: 4, fontFamily: "var(--font-display)" }}>DI Branch</div>
                <div style={{ color: "var(--text2)" }}>Opponent DIs: <span style={{ color: "#ef4444" }}>{tooltip.move.diDirection}</span></div>
                <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 4 }}>Adjust combo route accordingly</div>
              </>
            ) : (
              <>
                <div style={{ color: NODE_COLORS[tooltip.move.buttonInput]?.stroke, fontWeight: 700, marginBottom: 6, fontFamily: "var(--font-display)", fontSize: 14 }}>
                  {tooltip.move.label || `${tooltip.move.inputDirection} ${tooltip.move.buttonInput}`}
                </div>
                {[
                  ["Input",     `${tooltip.move.inputDirection} ${tooltip.move.buttonInput}`],
                  ["Move Type", tooltip.move.moveType],
                  ["Opp. DI",   tooltip.move.diDirection],
                  ["Kill",      tooltip.move.killConfirm ? "✦ Yes" : "No"],
                  ...(tooltip.move.buttonInput === "Dodge" ? [["Dodge Dir.", tooltip.move.dodgeDirection]] : []),
                ].map(([label, val]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}>
                    <span style={{ color: "var(--text3)", fontSize: 11 }}>{label}</span>
                    <span style={{ color: tooltip.move.killConfirm && label === "Kill" ? "#ef4444" : "var(--text1)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{val}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="fc-legend" style={{ marginTop: 8, marginBottom: 4 }}>
        {Object.entries(NODE_COLORS).map(([k, c]) => (
          <div key={k} className="fc-legend-item">
            <div className="fc-legend-dot" style={{ background: c.stroke }} />
            {k}
          </div>
        ))}
        <div className="fc-legend-item">
          <div className="fc-legend-dot" style={{ background: "#ef4444", border: "1px dashed #ef4444" }} />
          DI Branch / Kill
        </div>
      </div>
    </div>
  );
}

// ============================================================
// § 8 — MOVE SEQUENCE STRIP (compact)
// ============================================================

function MoveStrip({ sequence }) {
  return (
    <div className="seq-strip">
      {sequence.map((move, i) => (
        <div key={move.id || i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div className="move-chip" title={move.frameDataMoveId ? `Frame data: ${move.frameDataMoveId}` : ""}>
            {move.inputDirection !== "Neutral" && <span className="dir">{move.inputDirection.slice(0, 3)}·</span>}
            <span className="btn-i">{move.buttonInput.slice(0, 4)}</span>
            {move.frameDataMoveId && (
              <span style={{ marginLeft: 4, fontSize: 9, color: "var(--gold)" }}>◆</span>
            )}
          </div>
          {i < sequence.length - 1 && <span className="arrow">▶</span>}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// § 9 — DASHBOARD TAB
// ============================================================

function Dashboard() {
  const { state, dispatch } = useApp();
  const { combos } = state;

  // ── Filter state ──
  const [filterChar, setFilterChar] = useState("All");
  const [filterKill, setFilterKill] = useState("All"); // "All" | "Kill" | "Combo"

  // Characters that actually have combos in the DB
  const presentChars = useMemo(() => ["All", ...new Set(combos.map(c => c.character))], [combos]);

  // Apply both filters
  const filtered = useMemo(() => combos.filter(c => {
    const charOk = filterChar === "All" || c.character === filterChar;
    const killOk = filterKill === "All" || (filterKill === "Kill" ? c.killConfirm : !c.killConfirm);
    return charOk && killOk;
  }), [combos, filterChar, filterKill]);

  // Stats always reflect the full DB (not filtered)
  const stats = useMemo(() => ({
    total: combos.length,
    chars: new Set(combos.map(c => c.character)).size,
    kills: combos.filter(c => c.killConfirm).length,
    maxDmg: Math.max(...combos.map(c => c.totalDamage), 0),
    avgDmg: combos.length ? Math.round(combos.reduce((s, c) => s + c.totalDamage, 0) / combos.length) : 0,
  }), [combos]);

  const selectedCombo = combos.find(c => c.id === state.selectedComboId);

  const activeFilters = (filterChar !== "All" ? 1 : 0) + (filterKill !== "All" ? 1 : 0);

  return (
    <div>
      <div className="page-title">Combat <span>Intelligence</span> Dashboard</div>

      {/* Stat tiles */}
      <div className="stat-grid">
        {[
          { value: stats.total, label: "Total Combos", sub: "in database" },
          { value: stats.chars, label: "Characters", sub: "represented" },
          { value: stats.kills, label: "Kill Confirms", sub: "verified routes" },
          { value: stats.maxDmg + "%", label: "Max Damage", sub: "single combo" },
          { value: stats.avgDmg + "%", label: "Avg Damage", sub: "across all" },
        ].map((s, i) => (
          <div className="stat-tile" key={i}>
            <div className="stat-value glow">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="two-col">
        {/* Combo list */}
        <div className="card">
          {/* ── Filter bar ── */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Combos
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent3)", marginLeft: 8 }}>
                  {filtered.length}/{combos.length}
                </span>
              </div>
              {activeFilters > 0 && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => { setFilterChar("All"); setFilterKill("All"); }}
                  style={{ fontSize: 11, padding: "3px 10px" }}>
                  ✕ Clear filters
                </button>
              )}
            </div>

            {/* Character pills */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>
                Character
              </div>
              <div className="char-filter" style={{ gap: 6 }}>
                {presentChars.map(c => (
                  <button key={c} className={`char-pill ${filterChar === c ? "active" : ""}`}
                    onClick={() => setFilterChar(c)}
                    style={filterChar === c && c !== "All" ? { borderColor: charColor(c), color: charColor(c), background: `${charColor(c)}18` } : {}}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Kill confirm toggle pills */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>
                Type
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { id: "All",   label: "All Types" },
                  { id: "Kill",  label: "✦ Kill Confirms" },
                  { id: "Combo", label: "Combos Only" },
                ].map(opt => (
                  <button key={opt.id}
                    className={`char-pill ${filterKill === opt.id ? "active" : ""}`}
                    onClick={() => setFilterKill(opt.id)}
                    style={filterKill === opt.id && opt.id === "Kill"
                      ? { borderColor: "var(--red)", color: "var(--red)", background: "rgba(239,68,68,0.12)" }
                      : filterKill === opt.id && opt.id === "Combo"
                      ? { borderColor: "var(--accent)", color: "var(--accent3)", background: "rgba(99,102,241,0.12)" }
                      : {}}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scroll-list">
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: "32px 16px" }}>
                <div className="empty-icon">{combos.length === 0 ? "🎮" : "🔍"}</div>
                <div className="empty-text">{combos.length === 0 ? "No combos yet" : "No matches"}</div>
                <div className="empty-sub">{combos.length === 0 ? "Use the Builder to add combos" : "Try adjusting your filters"}</div>
              </div>
            ) : filtered.map(combo => (
              <div key={combo.id}
                className={`combo-row ${state.selectedComboId === combo.id ? "selected" : ""}`}
                onClick={() => dispatch({ type: "SELECT_COMBO", payload: combo.id })}>
                <div className="combo-char" style={{ color: charColor(combo.character) }}>{combo.character}</div>
                <div className="combo-dmg">{combo.totalDamage}%</div>
                <span className={`badge ${combo.killConfirm ? "badge-kill" : "badge-combo"}`}>
                  {combo.killConfirm ? "KILL" : "Combo"}
                </span>
                <span className="badge badge-pct">{combo.startPercent}–{combo.endPercent === 999 ? "∞" : combo.endPercent}%</span>
                <button className="icon-btn" title="Delete combo"
                  onClick={e => {
                    e.stopPropagation();
                    dispatch({ type: "DELETE_COMBO", payload: combo.id });
                    if (state.selectedComboId === combo.id)
                      dispatch({ type: "SELECT_COMBO", payload: null });
                  }}>✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* Selected combo detail */}
        <div className="card">
          {selectedCombo ? (
            <>
              <div className="card-title">Combo Detail</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: charColor(selectedCombo.character) }}>
                  {selectedCombo.character}
                </div>
                <span className={`badge ${selectedCombo.killConfirm ? "badge-kill" : "badge-combo"}`}>
                  {selectedCombo.killConfirm ? "✦ Kill Confirm" : "Combo"}
                </span>
              </div>

              <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Total Damage</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, color: "var(--gold)" }}>{selectedCombo.totalDamage}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Valid Range</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, color: "var(--cyan)" }}>
                    {selectedCombo.startPercent}–{selectedCombo.endPercent === 999 ? "∞" : selectedCombo.endPercent}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Moves</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, color: "var(--accent3)" }}>{selectedCombo.sequence.length}</div>
                </div>
              </div>

              {selectedCombo.notes && (
                <div style={{ background: "var(--bg3)", borderRadius: "var(--r)", padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--text1)", borderLeft: "3px solid var(--accent)" }}>
                  {selectedCombo.notes}
                </div>
              )}

              <div className="card-title">Input Sequence</div>
              <MoveStrip sequence={selectedCombo.sequence} />

              <hr className="divider" />
              <div className="card-title">Flowchart</div>
              <ComboFlowchart combo={selectedCombo} />
            </>
          ) : (
            <div className="empty" style={{ padding: "80px 24px" }}>
              <div className="empty-icon">◈</div>
              <div className="empty-text">Select a Combo</div>
              <div className="empty-sub">Click any combo to view its flowchart</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Character accent colors
function charColor(name) {
  const colors = {
    // Looney Tunes
    "Bugs Bunny":       "#a78bfa",
    "Taz":              "#84cc16",
    "Marvin the Martian": "#22c55e",
    // DC
    "Batman":           "#94a3b8",
    "Superman":         "#3b82f6",
    "Wonder Woman":     "#f59e0b",
    "Harley Quinn":     "#ec4899",
    "Joker":            "#a855f7",
    "Black Adam":       "#eab308",
    "Nubia":            "#b45309",
    "Raven":            "#7c3aed",
    // Scooby-Doo
    "Shaggy":           "#22c55e",
    "Velma":            "#f97316",
    // Adventure Time
    "Finn":             "#06b6d4",
    "Jake":             "#fbbf24",
    "Banana Guard":     "#facc15",
    "Marceline":        "#dc2626",
    // Game of Thrones
    "Arya Stark":       "#e2e8f0",
    // Steven Universe
    "Steven Universe":  "#f472b6",
    "Garnet":           "#ef4444",
    // Sports
    "LeBron James":     "#f59e0b",
    // Iron Giant
    "Iron Giant":       "#64748b",
    // Rick and Morty
    "Rick":             "#67e8f9",
    "Morty":            "#fde68a",
    // Tom and Jerry
    "Tom and Jerry":    "#f87171",
    // Original
    "Reindog":          "#38bdf8",
    // Horror
    "Jason Voorhees":   "#166534",
    // Gremlins
    "Gizmo":            "#a3e635",
    "Stripe":           "#78716c",
    // The Matrix
    "Agent Smith":      "#4ade80",
    // Beetlejuice
    "Beetlejuice":      "#1d4ed8",
    // Samurai Jack
    "Samurai Jack":     "#e7e5e4",
    // Powerpuff Girls
    "Powerpuff Girls":  "#f9a8d4",
  };
  return colors[name] || "var(--accent3)";
}

// ============================================================
// § 10 — COMBO BUILDER TAB
// ============================================================

const BLANK_MOVE = () => ({
  id: nanoid(), buttonInput: "Attack", inputDirection: "Neutral",
  moveType: "Grounded", dodgeDirection: "Neutral", diDirection: "None",
  killConfirm: false, label: "",
  frameDataMoveId: "",  // optional link to a Frame Data asset
});

const BLANK_COMBO = () => ({
  id: nanoid(), character: "Bugs Bunny", totalDamage: 0,
  startPercent: 0, endPercent: 100, killConfirm: false, notes: "",
  sequence: [BLANK_MOVE()],
});

function MoveEditor({ move, index, character, onChange, onDelete }) {
  const set = (k, v) => onChange({ ...move, [k]: v });
  const { state } = useApp();
  const fd = state.frameData || { moves: {}, media: {}, stats: {} };
  const fdMoves = fd.moves || {};
  const fdMedia = fd.media || {};
  const fdStats = fd.stats || {};

  // Group frame-data moves by character so the dropdown is browsable.
  // Optgroup whose name matches the combo's character bubbles to the top.
  const movesByChar = useMemo(() => {
    const out = {};
    for (const m of Object.values(fdMoves)) {
      if (!out[m.character]) out[m.character] = [];
      out[m.character].push(m);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (a.action || "").localeCompare(b.action || ""));
    }
    return out;
  }, [fdMoves]);

  const orderedChars = useMemo(() => {
    const chars = Object.keys(movesByChar);
    if (character && movesByChar[character]) {
      return [character, ...chars.filter(c => c !== character).sort()];
    }
    return chars.sort();
  }, [movesByChar, character]);

  const linkedMove   = move.frameDataMoveId ? fdMoves[move.frameDataMoveId] : null;
  const linkedMedia  = move.frameDataMoveId ? fdMedia[move.frameDataMoveId] : null;
  const linkedStats  = move.frameDataMoveId ? fdStats[move.frameDataMoveId] : null;
  const totalLoaded  = Object.keys(fdMoves).length;

  return (
    <div className="move-row">
      <div className="move-row-header">
        <span className="move-num">Move {index + 1}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label className="toggle-wrap" style={{ cursor: "pointer" }}>
            <span style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Kill</span>
            <label className="toggle">
              <input type="checkbox" checked={move.killConfirm} onChange={e => set("killConfirm", e.target.checked)} />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </label>
          <button className="icon-btn" onClick={onDelete} title="Remove move">✕</button>
        </div>
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        <div className="field">
          <label>Input</label>
          <select value={move.buttonInput} onChange={e => set("buttonInput", e.target.value)}>
            {ENUM.ButtonInput.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Direction</label>
          <select value={move.inputDirection} onChange={e => set("inputDirection", e.target.value)}>
            {ENUM.InputDirection.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Move Type</label>
          <select value={move.moveType} onChange={e => set("moveType", e.target.value)}>
            {ENUM.MoveType.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Opp. DI</label>
          <select value={move.diDirection} onChange={e => set("diDirection", e.target.value)}>
            {ENUM.DIDirection.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        {move.buttonInput === "Dodge" && (
          <div className="field">
            <label>Dodge Dir.</label>
            <select value={move.dodgeDirection} onChange={e => set("dodgeDirection", e.target.value)}>
              {ENUM.DodgeDirection.map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        )}
        {move.buttonInput === "Throw" && (
          <div className="field">
            <label>Throw Dir.</label>
            <select value={move.throwDirection || "Forward"} onChange={e => set("throwDirection", e.target.value)}>
              {ENUM.ThrowDirection.map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        )}
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Move Label</label>
          <input type="text" value={move.label} placeholder="e.g. Up Air, Side Smash..."
            onChange={e => set("label", e.target.value)} />
        </div>
      </div>

      {/* ── Frame Data link ────────────────────────────────── */}
      <div style={{
        marginTop: 10, paddingTop: 10,
        borderTop: "1px dashed var(--line)",
      }}>
        <div className="field">
          <label style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>Frame Data</span>
            <span style={{
              fontSize: 10, color: "var(--text3)", textTransform: "none",
              letterSpacing: 0, fontWeight: 400,
            }}>
              {totalLoaded === 0 ? "no moves loaded — upload via Import / Export" : `${totalLoaded} loaded`}
            </span>
          </label>
          <select
            value={move.frameDataMoveId || ""}
            onChange={e => set("frameDataMoveId", e.target.value)}
            disabled={totalLoaded === 0}
            style={{
              fontFamily: "var(--font-mono)", fontSize: 12,
            }}
          >
            <option value="">— No frame data linked —</option>
            {orderedChars.map(char => (
              <optgroup key={char} label={char + (char === character ? "  (current combo)" : "")}>
                {movesByChar[char].map(m => {
                  const tags = [];
                  if (fdMedia[m.id]) tags.push("🎬");
                  if (fdStats[m.id]) tags.push("📊");
                  const tagStr = tags.length ? ` ${tags.join("")}` : "";
                  return (
                    <option key={m.id} value={m.id}>
                      {m.action}{tagStr}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>

        {linkedMove && (
          <div style={{
            marginTop: 8, padding: "8px 12px",
            background: "var(--bg3)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r)",
            display: "flex", alignItems: "center", gap: 12,
            flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{
                fontSize: 12, fontFamily: "var(--font-mono)",
                color: "var(--accent3)", fontWeight: 700,
              }}>
                ✓ {linkedMove.character} · {linkedMove.action}
              </div>
              <div style={{
                fontSize: 11, color: "var(--text3)",
                fontFamily: "var(--font-mono)", marginTop: 2,
              }}>
                {linkedMove.durationFrames || 0}f total ·{" "}
                {(linkedMove.notifies?.filter(n => /hitbox/i.test(n.name)).length || 0)} hitbox windows
                {linkedMedia ? " · video attached" : ""}
                {linkedStats ? " · stats attached" : ""}
              </div>
            </div>
            {linkedMedia && (
              <video
                src={linkedMedia.url}
                muted playsInline controls
                style={{
                  width: 160, height: 90, background: "#000",
                  border: "1px solid var(--line)", borderRadius: 4,
                  objectFit: "contain",
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ComboBuilder() {
  const { dispatch, toast } = useApp();
  const [combo, setCombo] = useState(BLANK_COMBO());
  const [preview, setPreview] = useState(false);

  const setField = (k, v) => setCombo(c => ({ ...c, [k]: v }));
  const setMove = (i, m) => setCombo(c => ({ ...c, sequence: c.sequence.map((x, j) => j === i ? m : x) }));
  const addMove = () => setCombo(c => ({ ...c, sequence: [...c.sequence, BLANK_MOVE()] }));
  const removeMove = (i) => {
    if (combo.sequence.length === 1) { toast("A combo needs at least one move", "warn"); return; }
    setCombo(c => ({ ...c, sequence: c.sequence.filter((_, j) => j !== i) }));
  };

  const handleSave = () => {
    const errors = validateCombo(combo);
    if (errors.length) {
      errors.slice(0, 3).forEach(e => toast(e, "error"));
      return;
    }
    dispatch({ type: "ADD_COMBO", payload: { ...combo, id: nanoid() } });
    toast(`Combo saved for ${combo.character} (${combo.totalDamage}% dmg)`, "success");
    setCombo(BLANK_COMBO());
  };

  return (
    <div>
      <div className="page-title">Combo <span>Builder</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left: Metadata */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Combo Metadata</div>
            <div className="form-grid">
              <div className="field">
                <label>Character</label>
                <select value={combo.character} onChange={e => setField("character", e.target.value)}>
                  {ENUM.Characters.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Total Damage (%)</label>
                <input type="number" min="0" max="999" value={combo.totalDamage}
                  onChange={e => setField("totalDamage", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Start % (min percent)</label>
                <input type="number" min="0" max="999" value={combo.startPercent}
                  onChange={e => setField("startPercent", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>End % (999 = any)</label>
                <input type="number" min="0" max="999" value={combo.endPercent}
                  onChange={e => setField("endPercent", Number(e.target.value))} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Notes</label>
                <textarea value={combo.notes} onChange={e => setField("notes", e.target.value)}
                  placeholder="Describe this combo's setup, weaknesses, DI mix-ups..." />
              </div>
              <div className="field">
                <label>Kill Confirm</label>
                <label className="toggle-wrap" style={{ marginTop: 8, cursor: "pointer" }}>
                  <label className="toggle">
                    <input type="checkbox" checked={combo.killConfirm} onChange={e => setField("killConfirm", e.target.checked)} />
                    <span className="toggle-track" />
                    <span className="toggle-thumb" />
                  </label>
                  <span style={{ fontSize: 13, color: combo.killConfirm ? "var(--red)" : "var(--text3)" }}>
                    {combo.killConfirm ? "Yes — this is a kill confirm" : "No"}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className="card">
              <div className="card-title">Flowchart Preview</div>
              <ComboFlowchart combo={combo} />
            </div>
          )}
        </div>

        {/* Right: Sequence */}
        <div className="card">
          <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Move Sequence ({combo.sequence.length} moves)</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => !p)}>
              {preview ? "Hide" : "Preview"} Chart
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {combo.sequence.map((move, i) => (
              <MoveEditor key={move.id} move={move} index={i}
                character={combo.character}
                onChange={m => setMove(i, m)} onDelete={() => removeMove(i)} />
            ))}
          </div>

          <button className="btn btn-ghost" style={{ width: "100%", marginBottom: 12 }} onClick={addMove}>
            + Add Move
          </button>
          <hr className="divider" />
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave}>
              ✦ Save Combo
            </button>
            <button className="btn btn-ghost" onClick={() => setCombo(BLANK_COMBO())}>
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// § 11 — ANALYTICS TAB
// ============================================================

function Analytics() {
  const { state } = useApp();
  const { combos } = state;

  // Aggregate per character
  const charStats = useMemo(() => {
    const map = {};
    combos.forEach(c => {
      if (!map[c.character]) map[c.character] = { character: c.character, totalDmg: 0, count: 0, kills: 0, maxDmg: 0 };
      map[c.character].totalDmg += c.totalDamage;
      map[c.character].count++;
      if (c.killConfirm) map[c.character].kills++;
      if (c.totalDamage > map[c.character].maxDmg) map[c.character].maxDmg = c.totalDamage;
    });
    return Object.values(map).map(r => ({
      ...r, avgDmg: Math.round(r.totalDmg / r.count)
    })).sort((a, b) => b.maxDmg - a.maxDmg);
  }, [combos]);

  // Scatter: inputs vs damage
  const scatterData = useMemo(() => combos.map(c => ({
    x: c.sequence.length, y: c.totalDamage, name: c.character,
  })), [combos]);

  const maxDmgForChart = Math.max(...charStats.map(c => c.maxDmg), 1);

  return (
    <div>
      <div className="page-title">Analytics & <span>Comparisons</span></div>

      {combos.length === 0 ? (
        <div className="empty"><div className="empty-icon">📊</div><div className="empty-text">No combo data to analyze</div></div>
      ) : (
        <>
          {/* Summary table */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">Character Comparison</div>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Character</th><th>Combos</th><th>Avg Dmg</th><th>Max Dmg</th><th>Kill Confirms</th><th>Max Dmg Chart</th>
                </tr>
              </thead>
              <tbody>
                {charStats.map(r => (
                  <tr key={r.character}>
                    <td style={{ fontWeight: 600, color: charColor(r.character), fontFamily: "var(--font-display)" }}>{r.character}</td>
                    <td style={{ fontFamily: "var(--font-mono)", color: "var(--text1)" }}>{r.count}</td>
                    <td style={{ fontFamily: "var(--font-mono)", color: "var(--cyan)" }}>{r.avgDmg}%</td>
                    <td style={{ fontFamily: "var(--font-mono)", color: "var(--gold)", fontWeight: 700 }}>{r.maxDmg}%</td>
                    <td>
                      {r.kills > 0
                        ? <span className="badge badge-kill">{r.kills} kill{r.kills > 1 ? "s" : ""}</span>
                        : <span style={{ color: "var(--text3)", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ width: 160 }}>
                      <div className="prog-bar-wrap">
                        <div className="prog-bar" style={{ width: `${Math.round(r.maxDmg / maxDmgForChart * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="analytics-grid">
            {/* Bar chart */}
            <div className="card">
              <div className="card-title">Max Combo Damage by Character</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={charStats} margin={{ top: 4, right: 12, left: -10, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                  <XAxis dataKey="character" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "Exo 2" }}
                    angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "JetBrains Mono" }} unit="%" />
                  <Tooltip
                    contentStyle={{ background: "var(--bg3)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontFamily: "Exo 2" }}
                    labelStyle={{ color: "var(--accent3)" }}
                    cursor={{ fill: "rgba(99,102,241,0.08)" }} />
                  <Bar dataKey="maxDmg" fill="#6366f1" radius={[4, 4, 0, 0]} name="Max Damage %" />
                  <Bar dataKey="avgDmg" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Avg Damage %" />
                  <Legend wrapperStyle={{ color: "var(--text2)", fontFamily: "Exo 2", fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Scatter chart */}
            <div className="card">
              <div className="card-title">Inputs vs. Damage Output</div>
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 4, right: 12, left: -10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                  <XAxis dataKey="x" type="number" name="Move Count" label={{ value: "# Moves", position: "insideBottom", fill: "#94a3b8", fontSize: 11, dy: 16 }}
                    tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <YAxis dataKey="y" type="number" name="Damage" unit="%" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3", stroke: "rgba(99,102,241,0.4)" }}
                    contentStyle={{ background: "var(--bg3)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontFamily: "Exo 2" }}
                    formatter={(v, name) => name === "Damage" ? [`${v}%`, name] : [v, name]} />
                  <Scatter data={scatterData} fill="#f59e0b" opacity={0.85} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// § 12 — IMPORT / EXPORT TAB
// ============================================================

function ImportExport() {
  const { state, dispatch, toast } = useApp();
  const { combos } = state;
  const [drag, setDrag] = useState(false);
  const [filterChar, setFilterChar] = useState("All");
  const fileRef = useRef(null);

  /** Export full database or filtered by character */
  const handleExport = () => {
    const filtered = filterChar === "All" ? combos : combos.filter(c => c.character === filterChar);
    const payload = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      combos: filtered,
    };
    exportJSON(payload, `mvsi_combos_${filterChar.replace(/ /g, "_")}_${Date.now()}.json`);
    toast(`Exported ${filtered.length} combo${filtered.length !== 1 ? "s" : ""}`, "success");
  };

  /** Parse and validate an imported JSON file */
  const processFile = (file) => {
    if (!file || !file.name.endsWith(".json")) {
      toast("Only .json files are accepted", "error"); return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const errors = validateImport(data);
        if (errors.length) {
          toast(`Validation failed: ${errors[0]}`, "error");
          if (errors.length > 1) toast(`+ ${errors.length - 1} more error(s). Check console.`, "warn");
          console.error("[MVSI Import Validation]", errors);
          return;
        }
        // Assign fresh IDs to avoid collisions
        const incoming = data.combos.map(c => ({
          ...c,
          id: nanoid(),
          sequence: c.sequence.map(m => ({ ...m, id: nanoid() })),
        }));
        dispatch({ type: "IMPORT_COMBOS", payload: incoming });
        toast(`Imported ${incoming.length} combo${incoming.length !== 1 ? "s" : ""} successfully`, "success");
      } catch {
        toast("Invalid JSON file — could not parse", "error");
      }
    };
    reader.readAsText(file);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  };

  const chars = ["All", ...new Set(combos.map(c => c.character))];

  return (
    <div>
      <div className="page-title">Data <span>Import / Export</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Export */}
        <div className="card">
          <div className="card-title">Export Database</div>
          <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
            Serialize your combo database to a portable JSON file. Filter by character
            or export everything at once.
          </p>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Filter by Character</label>
            <select value={filterChar} onChange={e => setFilterChar(e.target.value)}>
              {chars.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ background: "var(--bg3)", borderRadius: "var(--r)", padding: 14, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "var(--text2)" }}>Combos to export</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>
                {filterChar === "All" ? combos.length : combos.filter(c => c.character === filterChar).length}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text2)" }}>Format</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--cyan)" }}>JSON v1.0.0</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleExport}
            disabled={combos.length === 0}>
            ↓ Download JSON
          </button>
          {combos.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8, textAlign: "center" }}>No combos in database to export</p>
          )}
        </div>

        {/* Import */}
        <div className="card">
          <div className="card-title">Import Database</div>
          <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
            Upload a previously exported MVSI JSON file. All combos will be validated
            against the schema before being merged into the current database.
          </p>

          <div className={`dropzone ${drag ? "drag" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}>
            <div className="dropzone-icon">{drag ? "📂" : "📁"}</div>
            <div className="dropzone-text">{drag ? "Release to upload" : "Drop JSON file here"}</div>
            <div className="dropzone-sub">or click to browse • .json only</div>
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }}
              onChange={e => processFile(e.target.files[0])} />
          </div>

          <hr className="divider" />
          <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7 }}>
            <div style={{ fontFamily: "var(--font-display)", color: "var(--text2)", marginBottom: 6, fontSize: 13 }}>Schema Validation Checks:</div>
            {[
              "✓ Root object with combos array",
              "✓ Character in known roster",
              "✓ Valid ButtonInput / Direction / MoveType enums",
              "✓ Numeric totalDamage and percent ranges",
              "✓ Boolean killConfirm on combos and moves",
            ].map(s => <div key={s}>{s}</div>)}
          </div>

          <hr className="divider" />
          <button className="btn btn-danger" style={{ width: "100%" }}
            onClick={() => {
              if (confirm("Clear ALL combo data from the database?")) {
                dispatch({ type: "REPLACE_COMBOS", payload: [] });
                toast("Database cleared", "warn");
              }
            }}>
            ✕ Clear Entire Database
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          FRAME DATA — Import / Export
          ════════════════════════════════════════════════════════ */}
      <FrameDataIO />

      {/* Export preview */}
      {combos.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-title">JSON Preview (first combo)</div>
          <pre style={{
            fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text1)",
            background: "var(--bg1)", borderRadius: "var(--r)", padding: 16,
            overflow: "auto", maxHeight: 300, border: "1px solid var(--line)",
          }}>
            {JSON.stringify(combos[0], null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================
// § 12b — FRAME DATA IMPORT / EXPORT
// ============================================================

/**
 * Re-encode a slice of a video file with optional zoom and slow-mo, baking
 * everything into the saved file. Output is WebM.
 *
 * The user trims/zooms/slows in the modal preview; this function makes
 * those choices stick — the saved clip IS what they previewed.
 *
 * opts: {
 *   trimStart, trimEnd     — seconds (slice of source to use)
 *   zoom                   — magnification multiplier (1 = no zoom)
 *   offsetX, offsetY       — point in source-pixel coords that becomes the
 *                            center of the output (default = video center)
 *   speed                  — playback rate baked in (1 = normal, 0.1 = 1/10×)
 *   onProgress(0..1)       — optional progress callback
 * }
 *
 * Wall-clock time ≈ (trimEnd - trimStart) / speed. So 1s @ 0.1× → ~10s.
 */
async function processVideoFile(file, opts) {
  const {
    trimStart = 0, trimEnd,
    zoom = 1, offsetX, offsetY,
    speed = 1,
    onProgress,
  } = opts || {};

  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Couldn't load video for processing"));
  });

  const startSec = Math.max(0, trimStart);
  const endSec   = Math.min(video.duration, trimEnd != null ? trimEnd : video.duration);
  const ox = offsetX != null ? offsetX : video.videoWidth  / 2;
  const oy = offsetY != null ? offsetY : video.videoHeight / 2;

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  let mimeType = null;
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }
  if (!mimeType) {
    URL.revokeObjectURL(video.src);
    throw new Error("Browser doesn't support MediaRecorder/WebM");
  }

  // Output canvas — same dimensions as source so zoomed pixels stay sharp.
  const canvas = document.createElement("canvas");
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  // Seek to start
  await new Promise((resolve) => {
    const h = () => { video.removeEventListener("seeked", h); resolve(); };
    video.addEventListener("seeked", h);
    video.currentTime = startSec;
  });
  await new Promise(r => setTimeout(r, 60));

  recorder.start();

  const sourceDuration = endSec - startSec;
  const outputDuration = sourceDuration / Math.max(0.001, speed);

  const drawFrame = () => {
    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    // Match the live preview transform: center, scale, then translate so
    // (ox, oy) in source space becomes the canvas center.
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-ox, -oy);
    ctx.imageSmoothingEnabled = zoom < 2;
    try { ctx.drawImage(video, 0, 0); } catch { /* not ready */ }
    ctx.restore();
  };

  await new Promise((resolve) => {
    let done = false;
    recorder.onstop = () => resolve();

    if (speed >= 0.0625) {
      // Browsers support playbackRate down to ~0.0625; use native playback
      try { video.playbackRate = speed; } catch { /* fallback */ }
      video.play().then(() => {
        const tick = () => {
          if (done) return;
          drawFrame();
          const elapsed = video.currentTime - startSec;
          if (onProgress) {
            onProgress(Math.max(0, Math.min(1, elapsed / Math.max(0.001, sourceDuration))));
          }
          if (video.currentTime >= endSec - 0.005 || video.ended) {
            done = true; video.pause(); recorder.stop();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }).catch(() => { done = true; recorder.stop(); });
    } else {
      // Sub-floor speeds: step source manually
      const wallStart = performance.now();
      const tick = () => {
        if (done) return;
        const wallElapsed = (performance.now() - wallStart) / 1000;
        const sourceTarget = Math.min(endSec, startSec + wallElapsed * speed);
        const targetFrame = Math.round(sourceTarget * 60);
        const currentFrame = Math.round(video.currentTime * 60);
        if (targetFrame !== currentFrame) {
          video.currentTime = sourceTarget;
        }
        drawFrame();
        if (onProgress) {
          onProgress(Math.max(0, Math.min(1, wallElapsed / outputDuration)));
        }
        if (sourceTarget >= endSec - 0.005) {
          done = true; recorder.stop();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    }
  });

  URL.revokeObjectURL(video.src);
  return new Blob(chunks, { type: mimeType });
}

// ============================================================

/**
 * Frame Data IO panel embedded in the Import/Export tab.
 *
 * - Bundle export: serializes current frame data to a single .json file
 *   (manifest entries + asset JSONs + stats sidecars inline). Videos are
 *   referenced by URL since base64-encoding multi-megabyte files is slow.
 *
 * - Loose-file drop: accepts a mix of JSON / video / GIF files and pairs
 *   them by base name. Asset JSONs are required to add a move; videos
 *   dropped without a matching JSON are rejected with a toast.
 *
 * - Bundle import: a single .json bundle replaces or merges current state.
 */
function FrameDataIO() {
  const { state, dispatch, toast } = useApp();
  const fd = state.frameData;
  const moves = fd.moves || {};
  const media = fd.media || {};
  const stats = fd.stats || {};
  const moveCount = Object.keys(moves).length;
  const mediaCount = Object.keys(media).length;
  const statsCount = Object.keys(stats).length;

  const [drag, setDrag] = useState(false);
  const [stagedSummary, setStagedSummary] = useState(null);
  // Videos dropped without a matching JSON go here; modal opens to resolve them.
  const [pendingVideos, setPendingVideos] = useState([]);
  const fileRef = useRef(null);
  const objectUrlsRef = useRef([]);

  // NOTE: we deliberately do NOT revoke these blob URLs on unmount.
  // They're referenced by the global frameData state, which outlives this
  // component. Revoking them on tab-change kills any video playback in
  // FrameDataTab (the URL becomes dead → video panel goes black).
  // The browser frees them automatically on page reload.

  /** Determine what kind of file something is. */
  const classifyFile = (file) => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".stats.json")) return "stats";
    if (name.endsWith(".json")) return "asset";
    if (file.type.startsWith("video/") ||
        /\.(mp4|webm|mov|m4v|gif)$/i.test(name)) return "video";
    if (file.type.startsWith("image/")) return "image";
    return "unknown";
  };

  /** Strip extensions to find the move's base name for pairing. */
  const baseName = (filename) => {
    return filename
      .replace(/\.stats\.json$/i, "")
      .replace(/\.(json|mp4|webm|mov|m4v|gif|png|jpe?g)$/i, "");
  };

  /** Read a file as text or array buffer. */
  const readText = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsText(file);
  });

  /** Process a multi-file drop: pair files by base name and validate. */
  const processFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // Group files by base name
    const groups = {}; // baseName -> { asset, video, stats, hasJsonAnywhere }
    for (const f of files) {
      const cls = classifyFile(f);
      if (cls === "unknown") {
        toast(`Skipping unrecognized file: ${f.name}`, "warn");
        continue;
      }
      // For pairing we use a "loose" base — strip _Montage_FAD from JSONs
      // and any common gameplay capture suffixes from videos so they line
      // up. Asset JSONs and stats sidecars use the SAME base.
      let base = baseName(f.name);
      // Stats sidecar file name is "<assetBase>.stats.json", and after
      // baseName() runs that becomes "<assetBase>" — same as the asset.
      if (!groups[base]) groups[base] = { asset: null, video: null, stats: null };
      if (cls === "asset") groups[base].asset = f;
      else if (cls === "video" || cls === "image") groups[base].video = f;
      else if (cls === "stats") groups[base].stats = f;
    }

    // Validation pass: enforce "video without JSON is rejected"
    const orphanVideos = [];
    const orphanStats = [];
    const additions = []; // { asset, video, stats } that are valid
    const allBases = Object.keys(groups);

    // First, look for any JSON among the dropped files OR already in state.
    // If a video lands with the same base as an existing move in state, it's OK
    // to attach without a fresh JSON.
    for (const base of allBases) {
      const g = groups[base];
      if (g.asset) {
        additions.push(g);
      } else {
        // No JSON in this drop. Check state for an existing move with matching id.
        // Move IDs look like "Mvs_Arya_Attack_Combo1_Montage_FAD" — base of the
        // dropped video might be "Mvs_Arya_Attack_Combo1" (no _Montage_FAD).
        // Try to match by prefix.
        let matchedMoveId = null;
        for (const moveId of Object.keys(moves)) {
          if (moveId === base || moveId.startsWith(base) || base.startsWith(moveId.replace(/_Montage_FAD$/, ""))) {
            matchedMoveId = moveId; break;
          }
        }
        if (matchedMoveId) {
          // Attach video/stats to existing move
          if (g.video) {
            const url = URL.createObjectURL(g.video);
            objectUrlsRef.current.push(url);
            dispatch({
              type: "FRAMEDATA_ATTACH_MEDIA",
              payload: {
                moveId: matchedMoveId,
                media: {
                  url,
                  type: g.video.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(g.video.name) ? "video" : "image",
                  name: g.video.name,
                  persisted: false,
                },
              },
            });
          }
          if (g.stats) {
            try {
              const txt = await readText(g.stats);
              const parsed = JSON.parse(txt);
              dispatch({
                type: "FRAMEDATA_ATTACH_STATS",
                payload: { moveId: matchedMoveId, stats: parsed },
              });
            } catch {
              toast(`Couldn't parse stats: ${g.stats.name}`, "error");
            }
          }
        } else {
          // No JSON in drop AND no matching move in state — stage for the
          // resolve-orphan modal instead of dropping the file on the floor.
          if (g.video) orphanVideos.push(g.video);  // ← keep the File, not just the name
          if (g.stats) orphanStats.push(g.stats.name);
        }
      }
    }

    // Stats orphans get a soft warn — they're rare and not user-recoverable
    // without an asset JSON, which would have made them paired in the drop.
    if (orphanStats.length > 0) {
      toast(
        `Skipped ${orphanStats.length} stats sidecar${orphanStats.length > 1 ? "s" : ""}: no matching move`,
        "warn"
      );
    }

    // Process valid additions
    let added = 0, mediaAttached = 0, statsAttached = 0;
    for (const g of additions) {
      try {
        const txt = await readText(g.asset);
        const json = JSON.parse(txt);
        const parsed = parseFrameDataAsset(json);
        if (parsed.length === 0) {
          toast(`No PfgFixedAnimDataAsset found in ${g.asset.name}`, "error");
          continue;
        }
        for (const m of parsed) {
          let mediaPayload = null;
          if (g.video) {
            const url = URL.createObjectURL(g.video);
            objectUrlsRef.current.push(url);
            mediaPayload = {
              url,
              type: g.video.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(g.video.name) ? "video" : "image",
              name: g.video.name,
              persisted: false,
            };
            mediaAttached++;
          }
          let statsPayload = null;
          if (g.stats) {
            try {
              statsPayload = JSON.parse(await readText(g.stats));
              statsAttached++;
            } catch {
              toast(`Couldn't parse ${g.stats.name}`, "error");
            }
          }
          dispatch({
            type: "FRAMEDATA_ADD_MOVE",
            payload: { move: m, media: mediaPayload, stats: statsPayload },
          });
          added++;
        }
      } catch (e) {
        console.error("[FrameData] failed to add", g.asset?.name, e);
        toast(`Couldn't parse ${g.asset?.name || "asset"}`, "error");
      }
    }

    if (added > 0) {
      toast(`Added ${added} move${added !== 1 ? "s" : ""}` +
            (mediaAttached ? ` with ${mediaAttached} video${mediaAttached !== 1 ? "s" : ""}` : "") +
            (statsAttached ? ` and ${statsAttached} stats file${statsAttached !== 1 ? "s" : ""}` : ""),
            "success");
    } else if (orphanVideos.length === 0 && orphanStats.length === 0) {
      toast("Nothing to add", "warn");
    }

    // Stage orphan videos for resolution via the modal — each gets a unique
    // id so we can track per-row state independently in the modal UI.
    if (orphanVideos.length > 0) {
      setPendingVideos(prev => [
        ...prev,
        ...orphanVideos.map((file, i) => ({
          id: Date.now() + "-" + i + "-" + Math.random().toString(36).slice(2, 8),
          file,
        })),
      ]);
      toast(
        `${orphanVideos.length} video${orphanVideos.length > 1 ? "s" : ""} need${orphanVideos.length > 1 ? "" : "s"} a JSON — see prompt`,
        "info"
      );
    }

    setStagedSummary({
      total: files.length,
      added,
      mediaAttached,
      statsAttached,
      orphanVideos: orphanVideos.length,
    });
  };

  /** Bundle import: a single .json bundle file. */
  const importBundle = async (file) => {
    try {
      const txt = await readText(file);
      const bundle = JSON.parse(txt);
      if (!bundle || !Array.isArray(bundle.moves)) {
        toast("Not a frame data bundle (missing 'moves' array)", "error");
        return;
      }
      const newMoves = {}, newMedia = {}, newStats = {};
      for (const entry of bundle.moves) {
        if (!entry.asset) continue;
        const parsed = parseFrameDataAsset(entry.asset);
        for (const m of parsed) {
          newMoves[m.id] = m;
          if (entry.media) newMedia[m.id] = { ...entry.media, persisted: true };
          if (entry.stats) newStats[m.id] = entry.stats;
        }
      }
      dispatch({
        type: "FRAMEDATA_REPLACE_ALL",
        payload: { moves: newMoves, media: newMedia, stats: newStats },
      });
      toast(`Imported bundle: ${Object.keys(newMoves).length} moves`, "success");
    } catch (e) {
      console.error(e);
      toast("Bundle import failed: invalid JSON", "error");
    }
  };

  /** Pick handler: route between bundle file and loose-files. */
  const onFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    // If exactly one .json file is dropped and it looks like a bundle
    // (has top-level "moves" array containing "asset" entries), treat as bundle import.
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".json") &&
        !files[0].name.toLowerCase().endsWith(".stats.json")) {
      try {
        const txt = await readText(files[0]);
        const data = JSON.parse(txt);
        if (data && Array.isArray(data.moves) && data.moves.length > 0 &&
            data.moves[0].asset) {
          // It's a bundle
          await importBundle(files[0]);
          return;
        }
      } catch {
        // not JSON — fall through to loose-file handling
      }
    }
    // Otherwise: loose-file drop
    await processFiles(files);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    onFiles(e.dataTransfer.files);
  };

  /** Bundle export: serialize current frame data to one downloadable JSON. */
  const exportBundle = () => {
    if (moveCount === 0) {
      toast("Nothing to export — frame data is empty", "warn");
      return;
    }
    const out = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      moves: Object.values(moves).map(m => {
        // Reconstruct the asset JSON shape from the parsed move so the bundle
        // is round-trip importable. We embed the original Properties form.
        const asset = {
          Type: "PfgFixedAnimDataAsset",
          Name: m.id,
          Properties: {
            Duration: { Data: Math.round(m.durationSec * 4294967296) },
            NotifyData: m.notifies.map(n => ({
              NotifyName: n.name,
              startTime: { Data: Math.round(n.startSec * 4294967296) },
              EndTime: { Data: Math.round(n.endSec * 4294967296) },
              TrackIndex: n.track,
              GroupName: n.group || "",
            })),
          },
        };
        const mediaEntry = media[m.id];
        const statsEntry = stats[m.id];
        return {
          asset: [asset],
          // Only include media if it's a persistent URL (not a blob); blobs
          // can't be serialized and re-imported, the user has to re-drop them.
          media: mediaEntry && mediaEntry.persisted ? {
            url: mediaEntry.url, type: mediaEntry.type, name: mediaEntry.name,
          } : null,
          stats: statsEntry || null,
          hasUserMedia: !!(mediaEntry && !mediaEntry.persisted),
        };
      }),
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mvsi_framedata_bundle_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${moveCount} move${moveCount !== 1 ? "s" : ""}`, "success");
  };

  const clearAll = () => {
    if (moveCount === 0) return;
    if (!confirm(`Remove all ${moveCount} frame data move${moveCount !== 1 ? "s" : ""}? Manifest reload will repopulate on refresh.`)) return;
    // Revoke any blob URLs we created
    Object.values(media).forEach(m => {
      if (m && !m.persisted) {
        try { URL.revokeObjectURL(m.url); } catch { /* ignore */ }
      }
    });
    dispatch({ type: "FRAMEDATA_REPLACE_ALL", payload: { moves: {}, media: {}, stats: {} } });
    toast("Frame data cleared", "warn");
  };

  return (
    <>
      <div className="page-title" style={{ marginTop: 24 }}>Frame <span>Data</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* ── Export ── */}
        <div className="card">
          <div className="card-title">Export Frame Data</div>
          <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
            Bundle every loaded asset JSON and stats sidecar into one
            downloadable file. Re-importable later.
          </p>
          <div style={{ background: "var(--bg3)", borderRadius: "var(--r)", padding: 14, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "var(--text2)" }}>Moves loaded</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>{moveCount}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "var(--text2)" }}>With video</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--cyan)" }}>{mediaCount}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text2)" }}>With stats sidecar</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--gold)" }}>{statsCount}</span>
            </div>
          </div>
          <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
            <strong style={{ color: "var(--gold)" }}>Note:</strong> Videos
            uploaded in this session aren't embedded (too large). Persisted
            videos from the manifest are referenced by URL. Re-drop your
            uploaded videos after re-importing the bundle.
          </p>
          <button className="btn btn-primary" style={{ width: "100%" }}
                  onClick={exportBundle} disabled={moveCount === 0}>
            ↓ Download Bundle JSON
          </button>
        </div>

        {/* ── Import ── */}
        <div className="card">
          <div className="card-title">Import Frame Data</div>
          <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12, lineHeight: 1.6 }}>
            Drop one or more files. The drop zone accepts:
          </p>
          <ul style={{ fontSize: 12, color: "var(--text2)", marginBottom: 16, paddingLeft: 18, lineHeight: 1.8 }}>
            <li><span style={{ color: "var(--accent3)" }}>Asset JSON</span> &middot; <code style={{ color: "var(--gold)", fontSize: 11 }}>*_Montage_FAD.json</code> — the move definition</li>
            <li><span style={{ color: "var(--cyan)" }}>Video / GIF</span> &middot; <code style={{ color: "var(--gold)", fontSize: 11 }}>.mp4 .webm .gif</code> — paired by base name</li>
            <li><span style={{ color: "var(--gold)" }}>Stats sidecar</span> &middot; <code style={{ color: "var(--gold)", fontSize: 11 }}>*.stats.json</code> — manual damage / KB values</li>
            <li><span style={{ color: "var(--green)" }}>Bundle</span> &middot; previously-exported bundle JSON</li>
          </ul>

          <div className={`dropzone ${drag ? "drag" : ""}`}
               onClick={() => fileRef.current?.click()}
               onDragOver={e => { e.preventDefault(); setDrag(true); }}
               onDragLeave={() => setDrag(false)}
               onDrop={onDrop}>
            <div className="dropzone-icon">{drag ? "📂" : "🎬"}</div>
            <div className="dropzone-text">{drag ? "Release to upload" : "Drop frame data files"}</div>
            <div className="dropzone-sub">or click to browse · multi-select supported</div>
            <input ref={fileRef} type="file" multiple
                   accept=".json,.mp4,.webm,.mov,.m4v,.gif,video/*"
                   style={{ display: "none" }}
                   onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </div>

          <div style={{
            marginTop: 12, padding: "10px 14px",
            background: "rgba(239,68,68,0.05)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "var(--r)", fontSize: 12, color: "var(--text2)",
            lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--gold)" }}>Pairing tip:</strong> drop a
            video alongside its asset JSON to attach in one step. If you
            drop a video without a JSON, you'll get a prompt asking for the
            JSON or to attach it to a move that's already loaded.
          </div>

          {stagedSummary && (
            <div style={{
              marginTop: 12, padding: "10px 14px",
              background: "var(--bg3)", borderRadius: "var(--r)",
              fontSize: 12, color: "var(--text1)", fontFamily: "var(--font-mono)",
            }}>
              Last drop: {stagedSummary.total} file{stagedSummary.total !== 1 ? "s" : ""} →{" "}
              {stagedSummary.added > 0 && <span style={{ color: "var(--green)" }}>+{stagedSummary.added} move{stagedSummary.added !== 1 ? "s" : ""} </span>}
              {stagedSummary.mediaAttached > 0 && <span style={{ color: "var(--cyan)" }}>· {stagedSummary.mediaAttached} video</span>}
              {stagedSummary.statsAttached > 0 && <span style={{ color: "var(--gold)" }}>· {stagedSummary.statsAttached} stats</span>}
              {stagedSummary.orphanVideos > 0 && <span style={{ color: "var(--gold)" }}> · {stagedSummary.orphanVideos} need JSON</span>}
            </div>
          )}

          <hr className="divider" />
          <button className="btn btn-danger" style={{ width: "100%" }}
                  onClick={clearAll} disabled={moveCount === 0}>
            ✕ Clear All Frame Data ({moveCount})
          </button>
        </div>
      </div>

      {/* ── Resolve-orphan modal ── */}
      <ResolveOrphansModal
        pending={pendingVideos}
        moves={moves}
        onClose={() => setPendingVideos([])}
        onResolve={async (resolutions) => {
          // resolutions: array aligned with pendingVideos:
          //   { type: "skip" }
          //   { type: "attach-existing", moveId }
          //   { type: "upload-json", jsonFile, statsFile? }
          let attached = 0, addedNew = 0, skipped = 0;
          for (let i = 0; i < pendingVideos.length; i++) {
            const entry = pendingVideos[i];
            const r = resolutions[i];
            if (!r || r.type === "skip") { skipped++; continue; }

            // Detect if the saved file should be re-encoded with the user's
            // preview settings baked in. Re-encode when:
            //   - they trimmed (start/end differ from full clip), OR
            //   - they zoomed (scale > ~1.05), OR
            //   - they slowed (speed < ~0.95)
            const trimWasMoved = (
              r.trimStart != null &&
              r.trimEnd   != null &&
              r.trimDuration != null &&
              (r.trimStart > 0.05 || r.trimEnd < r.trimDuration - 0.05) &&
              (r.trimEnd - r.trimStart) > 0.1
            );
            const zoomWasApplied  = r.zoom  != null && r.zoom  > 1.05;
            const slowMoApplied   = r.speed != null && r.speed < 0.95;
            const needsReencode   = trimWasMoved || zoomWasApplied || slowMoApplied;

            // The actual file we save — original, or a re-encoded version
            // that bakes in trim + zoom + slow-mo so the saved clip plays
            // exactly as previewed (zoomed, slowed, trimmed) in Frame Data.
            let savedFile = entry.file;
            let savedName = entry.file.name;
            if (needsReencode) {
              try {
                const tStart = trimWasMoved ? r.trimStart : 0;
                const tEnd   = trimWasMoved ? r.trimEnd   : (r.trimDuration ?? null);
                const speed  = slowMoApplied ? r.speed : 1;
                const zoom   = zoomWasApplied ? r.zoom : 1;
                const desc = [
                  trimWasMoved && "trim",
                  zoomWasApplied && "zoom",
                  slowMoApplied && `${(1/speed).toFixed(0)}× slow-mo`,
                ].filter(Boolean).join(" + ");
                toast(`Saving ${entry.file.name} (${desc})…`, "info");

                const blob = await processVideoFile(entry.file, {
                  trimStart: tStart,
                  trimEnd:   tEnd,
                  zoom,
                  offsetX:   r.offsetX,
                  offsetY:   r.offsetY,
                  speed,
                });
                savedFile = blob;
                const stem = entry.file.name.replace(/\.[^.]+$/, "");
                const tag  = [trimWasMoved && "trim", zoomWasApplied && "zoom", slowMoApplied && "slow"].filter(Boolean).join("-");
                savedName = `${stem}_${tag || "edit"}.webm`;
              } catch (e) {
                console.warn("[FrameData] re-encode failed, using full clip:", e);
                toast("Couldn't process video — using original", "warn");
              }
            }

            const url = URL.createObjectURL(savedFile);
            objectUrlsRef.current.push(url);
            const isVideoMime =
              savedFile.type?.startsWith("video/") ||
              /\.(mp4|webm|mov|m4v)$/i.test(savedName);
            const mediaPayload = {
              url,
              type: isVideoMime ? "video" : "image",
              // If the user typed a custom name, use it as the video's display
              // label; otherwise fall back to the (possibly re-encoded) filename.
              name: (r.name && r.name.trim()) || savedName,
              persisted: false,
              // Saved file IS the processed range/zoom/slow now; metadata kept
              // for export bundles and debugging.
              ...(needsReencode ? {
                processed: {
                  trim:  trimWasMoved ? { start: r.trimStart, end: r.trimEnd } : null,
                  zoom:  zoomWasApplied ? r.zoom : 1,
                  speed: slowMoApplied ? r.speed : 1,
                },
              } : {}),
            };

            if (r.type === "attach-existing") {
              dispatch({ type: "FRAMEDATA_ATTACH_MEDIA", payload: { moveId: r.moveId, media: mediaPayload } });
              attached++;
            } else if (r.type === "upload-json") {
              try {
                const txt = await readText(r.jsonFile);
                const json = JSON.parse(txt);
                const parsed = parseFrameDataAsset(json);
                if (parsed.length === 0) {
                  toast(`No PfgFixedAnimDataAsset found in ${r.jsonFile.name}`, "error");
                  URL.revokeObjectURL(url);
                  continue;
                }
                let statsPayload = null;
                if (r.statsFile) {
                  try { statsPayload = JSON.parse(await readText(r.statsFile)); }
                  catch { toast(`Couldn't parse ${r.statsFile.name}`, "error"); }
                }
                // If the user typed a custom name, override the FIRST parsed
                // move's action so it shows up in dropdowns / lists with that
                // name instead of whatever was inside the JSON.
                const customName = r.name && r.name.trim();
                // Attach the video to the FIRST parsed move; remaining moves
                // get the asset and stats but no media.
                parsed.forEach((m, idx) => {
                  const finalMove = (idx === 0 && customName)
                    ? { ...m, action: customName }
                    : m;
                  dispatch({
                    type: "FRAMEDATA_ADD_MOVE",
                    payload: {
                      move: finalMove,
                      media: idx === 0 ? mediaPayload : null,
                      stats: statsPayload,
                    },
                  });
                });
                addedNew += parsed.length;
              } catch (e) {
                console.error(e);
                toast(`Couldn't parse ${r.jsonFile.name}`, "error");
                URL.revokeObjectURL(url);
              }
            }
          }
          if (attached + addedNew > 0) {
            const parts = [];
            if (addedNew > 0)  parts.push(`${addedNew} new move${addedNew !== 1 ? "s" : ""}`);
            if (attached > 0)  parts.push(`${attached} video${attached !== 1 ? "s" : ""} attached`);
            toast(parts.join(" · "), "success");
          }
          if (skipped > 0) toast(`${skipped} video${skipped !== 1 ? "s" : ""} skipped`, "info");
          setPendingVideos([]);
        }}
      />
    </>
  );
}

// ============================================================
// § 12c — RESOLVE ORPHANS MODAL
// ============================================================

/**
 * Modal that prompts the user to provide a JSON for each video that was
 * uploaded without one. For each pending video, the user picks one of:
 *   • Upload an asset JSON file (and optionally a stats sidecar)
 *   • Attach to an already-loaded move (by id)
 *   • Skip — discard the video
 */
function ResolveOrphansModal({ pending, moves, onClose, onResolve }) {
  // Single-video-at-a-time flow. For each video the user:
  //   1. Reviews it in a FrameLab-style preview (auto-zoom, 1/10× slow-mo,
  //      drag A/B trim handles).
  //   2. Picks where it goes — upload JSON, attach to existing move, or skip.
  //   3. Click Apply & Next to advance to the next pending video.
  const [index, setIndex] = useState(0);
  const [resolutions, setResolutions] = useState({});
  const [trims, setTrims] = useState({});

  const jsonInputRef = useRef(null);
  const statsInputRef = useRef(null);

  // Ref to OrphanPreview so we can pull current zoom/offset/speed at apply time
  const previewRef = useRef(null);

  // Refs for validation shake-and-scroll
  const attachSectionRef = useRef(null);
  const jsonRowRef       = useRef(null);
  const existingRowRef   = useRef(null);

  // IMPORTANT: this early return MUST come after all hook calls above —
  // otherwise React sees a different number of hooks between renders
  // (error #310: "Rendered more hooks than during the previous render").
  if (!pending || pending.length === 0) return null;

  const moveOptions = Object.values(moves || {})
    .map(m => ({ id: m.id, label: `${m.character} · ${m.action}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const entry = pending[index];
  const r = resolutions[entry.id] || {};
  const trim = trims[entry.id] || { a: 0, b: 0, duration: 0 };

  const setRes  = (patch) => setResolutions(prev => ({ ...prev, [entry.id]: { ...(prev[entry.id] || {}), ...patch } }));
  const setTrim = (patch) => setTrims(prev => ({ ...prev, [entry.id]: { ...(prev[entry.id] || { a: 0, b: 0, duration: 0 }), ...patch } }));

  const shakeAndScroll = (el) => {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("op-shake");
    // force reflow so the animation can re-trigger if user clicks again
    void el.offsetWidth;
    el.classList.add("op-shake");
    setTimeout(() => el.classList.remove("op-shake"), 600);
  };

  const isReady = () => {
    if (!r.type) return false;
    if (r.type === "skip") return true;
    if (r.type === "attach-existing") return !!r.moveId;
    if (r.type === "upload-json") return !!r.jsonFile;
    return false;
  };

  // Pull the live preview settings (zoom, pan, speed) for the current entry.
  const captureSettings = () => {
    const s = previewRef.current?.getSettings?.();
    if (!s) return null;
    return {
      scale: s.scale,
      offsetX: s.offsetX,
      offsetY: s.offsetY,
      speed: s.speed,
      videoWidth: s.videoWidth,
      videoHeight: s.videoHeight,
    };
  };

  const applyAndNext = () => {
    if (!isReady()) {
      // Tell the user what's missing — shake and scroll the right box
      if (!r.type) {
        shakeAndScroll(attachSectionRef.current);
      } else if (r.type === "upload-json" && !r.jsonFile) {
        shakeAndScroll(jsonRowRef.current);
      } else if (r.type === "attach-existing" && !r.moveId) {
        shakeAndScroll(existingRowRef.current);
      }
      return;
    }

    // Snapshot the preview's current zoom/pan/speed for THIS entry, since
    // OrphanPreview's state goes away when we move on to the next video.
    const settings = captureSettings();
    const baseTrim = trims[entry.id] || { a: 0, b: 0, duration: 0 };
    const fullTrim = settings ? { ...baseTrim, ...settings } : baseTrim;

    if (index < pending.length - 1) {
      setTrims(prev => ({ ...prev, [entry.id]: fullTrim }));
      setIndex(index + 1);
    } else {
      // Last one — submit the whole batch (use locally-merged trim for this entry)
      const updatedTrims = { ...trims, [entry.id]: fullTrim };
      const ordered = pending.map((p) => {
        const res = resolutions[p.id] || { type: "skip" };
        const t = updatedTrims[p.id];
        return t && (res.type !== "skip")
          ? {
              ...res,
              trimStart: t.a, trimEnd: t.b, trimDuration: t.duration,
              // bake-in settings (may be undefined if user never opened preview)
              zoom: t.scale, offsetX: t.offsetX, offsetY: t.offsetY,
              speed: t.speed,
              videoWidth: t.videoWidth, videoHeight: t.videoHeight,
            }
          : res;
      });
      onResolve(ordered);
    }
  };

  const skipThis = () => {
    setRes({ type: "skip" });
    if (index < pending.length - 1) setIndex(index + 1);
    else applyAndNext();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(7,8,13,0.85)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "var(--bg1)",
        border: "1px solid var(--accent)",
        boxShadow: "0 0 48px rgba(99,102,241,0.25)",
        borderRadius: "var(--r2)",
        width: "min(820px, 100%)",
        maxHeight: "92vh",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: 20, fontWeight: 700, letterSpacing: 1.5,
              textTransform: "uppercase", color: "var(--accent3)",
            }}>
              Review &amp; Attach
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              letterSpacing: 0.5, color: "var(--text2)", marginTop: 4,
              maxWidth: 520, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {entry.file.name}
            </div>
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            letterSpacing: 0.5, color: "var(--text3)",
          }}>
            Video {index + 1} / {pending.length}
          </div>
        </div>

        {/* Body — scrollable */}
        <div style={{ overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ═══ Preview pane ═══ */}
          <OrphanPreview
            ref={previewRef}
            file={entry.file}
            onTrimChange={(a, b, dur) => setTrim({ a, b, duration: dur })}
          />

          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />

          {/* ═══ Move name — prominent, always visible ═══ */}
          <div style={{
            background: "rgba(99, 102, 241, 0.06)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--r)",
            padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <label style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontFamily: "var(--font-display)",
              fontSize: 13, fontWeight: 700, letterSpacing: 1.5,
              textTransform: "uppercase", color: "var(--accent3)",
            }}>
              <span>Name this Move</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 9,
                letterSpacing: 0.5, color: "var(--text3)",
                textTransform: "none", fontWeight: 400,
              }}>
                optional · used as the display label
              </span>
            </label>
            <input
              type="text"
              placeholder={`e.g. "Up Air", "Forward Smash", "Neutral Special"…`}
              value={r.name || ""}
              onChange={(e) => setRes({ name: e.target.value })}
              autoFocus
              style={{
                background: "var(--bg3)",
                color: "var(--text0)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}
            />
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              letterSpacing: 0.3, color: "var(--text3)",
            }}>
              {r.type === "upload-json"
                ? "→ Overrides the move name from the JSON file."
                : r.type === "attach-existing"
                  ? "→ Becomes the video's display label on the linked move."
                  : "→ This name will be used after you pick where the video goes below."}
            </div>
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />

          {/* ═══ Attach options ═══ */}
          <div ref={attachSectionRef} style={{
            display: "flex", flexDirection: "column",
            padding: "8px 10px",
            border: "1px solid transparent",
            borderRadius: "var(--r)",
            transition: "border-color 0.2s",
          }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: 13, fontWeight: 700, letterSpacing: 1.5,
              textTransform: "uppercase", color: "var(--text1)",
              marginBottom: 4,
            }}>
              Attach to
            </div>

            {/* Upload JSON */}
            <label
              ref={jsonRowRef}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                cursor: "pointer", fontSize: 13,
                borderRadius: 4,
                border: "1px solid transparent",
                transition: "border-color 0.2s",
              }}>
              <input type="radio" name={`r-${entry.id}`}
                     checked={r.type === "upload-json"}
                     onChange={() => setRes({ type: "upload-json" })} />
              <span style={{ flex: "0 0 auto" }}>Upload asset JSON</span>
              <button
                className="btn btn-secondary"
                style={{ padding: "4px 12px", fontSize: 12, marginLeft: 8 }}
                onClick={() => jsonInputRef.current?.click()}
              >
                {r.jsonFile ? `✓ ${r.jsonFile.name.length > 32 ? r.jsonFile.name.slice(0, 30) + "…" : r.jsonFile.name}` : "Choose .json"}
              </button>
              {r.jsonFile && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() => statsInputRef.current?.click()}
                  title="Optional stats sidecar"
                >
                  {r.statsFile ? "✓ stats" : "+ stats"}
                </button>
              )}
              <input
                ref={jsonInputRef}
                type="file" accept=".json" style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setRes({ type: "upload-json", jsonFile: f });
                  e.target.value = "";
                }}
              />
              <input
                ref={statsInputRef}
                type="file" accept=".json" style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setRes({ type: "upload-json", jsonFile: r.jsonFile, statsFile: f });
                  e.target.value = "";
                }}
              />
            </label>

            {/* Attach to existing */}
            <label
              ref={existingRowRef}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                cursor: "pointer", fontSize: 13,
                borderRadius: 4,
                border: "1px solid transparent",
                transition: "border-color 0.2s",
              }}>
              <input type="radio" name={`r-${entry.id}`}
                     disabled={moveOptions.length === 0}
                     checked={r.type === "attach-existing"}
                     onChange={() => setRes({ type: "attach-existing" })} />
              <span>Attach to existing move</span>
              <select
                value={r.type === "attach-existing" ? (r.moveId || "") : ""}
                disabled={moveOptions.length === 0}
                onChange={(e) => {
                  // Picking from the dropdown implicitly selects the radio.
                  // No need to click the radio first — that was the UX bug
                  // that made "attach to existing" feel broken.
                  if (e.target.value) {
                    setRes({ type: "attach-existing", moveId: e.target.value });
                  } else if (r.type === "attach-existing") {
                    setRes({ type: "attach-existing", moveId: "" });
                  }
                }}
                style={{
                  flex: 1, marginLeft: 8,
                  background: "var(--bg3)",
                  color: "var(--text0)",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  padding: "5px 8px",
                  fontSize: 12,
                }}
              >
                <option value="">
                  {moveOptions.length === 0 ? "(no moves loaded)" : "— pick a move —"}
                </option>
                {moveOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>

            {/* Skip */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", cursor: "pointer", fontSize: 13 }}>
              <input type="radio" name={`r-${entry.id}`}
                     checked={r.type === "skip"}
                     onChange={() => setRes({ type: "skip" })} />
              <span style={{ color: "var(--text2)" }}>Skip — discard this video</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid var(--line)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10,
        }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel All</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary"
                    onClick={() => setIndex(Math.max(0, index - 1))}
                    disabled={index === 0}>
              ◀ Prev
            </button>
            <button className="btn btn-secondary" onClick={skipThis}>
              Skip This
            </button>
            <button className="btn btn-primary" onClick={applyAndNext}>
              {index < pending.length - 1 ? "Apply & Next ▶" : "Apply & Finish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// § 12d — ORPHAN VIDEO PREVIEW (canvas + auto-zoom + trim)
// ============================================================

/**
 * In-modal preview pane: shows the orphan video on a canvas with auto-zoom
 * on motion, defaulting to 2× zoom and 1/10× slow-mo. Has draggable A/B
 * trim handles whose values are reported up via onTrimChange.
 *
 * Self-contained — keeps its own playback state. Reuses MoveStudio's CSS
 * tokens (.ms-* classes) since they're MVSI-themed and already loaded by
 * the Move Studio tab. We inject a small subset of styles inline for the
 * cases where Move Studio isn't currently mounted.
 */
const OrphanPreview = forwardRef(function OrphanPreview({ file, onTrimChange }, ref) {
  const stageRef    = useRef(null);
  const canvasRef   = useRef(null);
  const videoRef    = useRef(null);
  const scrubberRef = useRef(null);
  const handleARef  = useRef(null);
  const handleBRef  = useRef(null);
  const objectUrlRef = useRef(null);

  // Drag state lives in refs so it persists across re-renders. Without this,
  // the parent's onTrimChange callback gets a fresh identity each time we
  // call it (because parent re-renders), the scrubber effect re-runs and
  // tears down its window listeners — mid-drag — which kills the drag.
  const dragMarkerRef = useRef(null);   // null | "A" | "B"
  const scrubbingRef  = useRef(false);
  const seekRafRef    = useRef(null);
  const pendingSeekRef = useRef(null);

  // Stable callback ref so the scrubber effect never depends on the parent's
  // arrow-function identity.
  const onTrimChangeRef = useRef(onTrimChange);
  useEffect(() => { onTrimChangeRef.current = onTrimChange; }, [onTrimChange]);

  const stateRef = useRef({
    fps: 60,
    speed: 0.1,
    scale: 2.0,
    offsetX: 0, offsetY: 0,
    playing: false,
    loopA: 0, loopB: 0,
    duration: 0,
    busy: false,
    manualPlay: null,
  });

  // Expose current preview settings to the parent modal so it can bake
  // them into the saved video at apply time.
  useImperativeHandle(ref, () => ({
    getSettings: () => {
      const s = stateRef.current;
      const v = videoRef.current;
      return {
        scale: s.scale,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        speed: s.speed,
        videoWidth: v?.videoWidth || 0,
        videoHeight: v?.videoHeight || 0,
        loopA: s.loopA,
        loopB: s.loopB,
        duration: s.duration,
      };
    },
  }), []);

  const [hasVideo, setHasVideo] = useState(false);
  const [playing, setPlaying]   = useState(false);
  const [scaleUI, setScaleUI]   = useState(2.0);
  const [speedUI, setSpeedUI]   = useState(0.1);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [autoTagShown, setAutoTagShown] = useState(false);

  // Load the file
  useEffect(() => {
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setHasVideo(true);
    setAutoTagShown(false);
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (v) { v.src = url; v.load(); }
    });
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, [file]);

  const getEffectiveScale = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v?.videoWidth || !c) return 1;
    const fit = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
    return fit * stateRef.current.scale;
  }, []);

  const clampOffset = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v?.videoWidth || !c) return;
    const eff = getEffectiveScale();
    const sw = c.width / eff, sh = c.height / eff;
    const s = stateRef.current;
    if (sw >= v.videoWidth)  s.offsetX = v.videoWidth / 2;
    else s.offsetX = Math.max(sw / 2, Math.min(v.videoWidth - sw / 2, s.offsetX));
    if (sh >= v.videoHeight) s.offsetY = v.videoHeight / 2;
    else s.offsetY = Math.max(sh / 2, Math.min(v.videoHeight - sh / 2, s.offsetY));
  }, [getEffectiveScale]);

  const resizeCanvas = useCallback(() => {
    const stage = stageRef.current, c = canvasRef.current;
    if (!stage || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";
  }, []);

  // Render loop
  useEffect(() => {
    let raf;
    const tick = () => {
      const v = videoRef.current, c = canvasRef.current;
      if (v && v.readyState >= 2 && c && c.width > 0) {
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, c.width, c.height);
        const eff = getEffectiveScale();
        ctx.save();
        ctx.translate(c.width / 2, c.height / 2);
        ctx.scale(eff, eff);
        ctx.translate(-stateRef.current.offsetX, -stateRef.current.offsetY);
        ctx.imageSmoothingEnabled = stateRef.current.scale < 2;
        try { ctx.drawImage(v, 0, 0); } catch { /* not ready */ }
        ctx.restore();
      }
      // Update DOM bits
      if (v && isFinite(v.duration)) {
        const pct = (v.currentTime / v.duration) * 100;
        const fill = stageRef.current?.parentNode?.querySelector(".op-fill");
        const handle = stageRef.current?.parentNode?.querySelector(".op-handle-play");
        if (fill) fill.style.width = pct + "%";
        if (handle) handle.style.left = pct + "%";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getEffectiveScale]);

  // Resize observer
  useEffect(() => {
    const onR = () => resizeCanvas();
    window.addEventListener("resize", onR);
    if (typeof ResizeObserver !== "undefined" && stageRef.current) {
      const ro = new ResizeObserver(onR);
      ro.observe(stageRef.current);
      return () => { window.removeEventListener("resize", onR); ro.disconnect(); };
    }
    return () => window.removeEventListener("resize", onR);
  }, [resizeCanvas]);

  // After load, fit canvas
  useEffect(() => {
    if (!hasVideo) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(resizeCanvas));
    return () => cancelAnimationFrame(id);
  }, [hasVideo, resizeCanvas]);

  // Auto-analyze on metadata
  const analyzeMotion = useCallback(async () => {
    const v = videoRef.current;
    if (!v?.videoWidth || stateRef.current.busy) return;
    stateRef.current.busy = true;
    setAnalyzing(true);
    setAnalyzeProgress(0);

    const W = 192;
    const H = Math.max(2, Math.round(W * v.videoHeight / v.videoWidth));
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    const SAMPLES = Math.min(40, Math.max(14, Math.floor(v.duration * 5)));
    const motionMap = new Float32Array(W * H);
    let prevData = null;

    try {
      for (let i = 0; i <= SAMPLES; i++) {
        const t = (i / SAMPLES) * v.duration;
        await new Promise((resolve) => {
          const h = () => { v.removeEventListener("seeked", h); resolve(); };
          v.addEventListener("seeked", h);
          v.currentTime = Math.min(v.duration - 0.001, t);
        });
        await new Promise(r => setTimeout(r, 16));

        offCtx.drawImage(v, 0, 0, W, H);
        const data = offCtx.getImageData(0, 0, W, H).data;
        if (prevData) {
          for (let p = 0; p < W * H; p++) {
            const i4 = p * 4;
            const dr = Math.abs(data[i4]   - prevData[i4]);
            const dg = Math.abs(data[i4+1] - prevData[i4+1]);
            const db = Math.abs(data[i4+2] - prevData[i4+2]);
            const diff = dr + dg + db;
            if (diff > 28) motionMap[p] += diff;
          }
        }
        prevData = new Uint8ClampedArray(data);
        setAnalyzeProgress(i / SAMPLES);
        if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
      }

      let totalW = 0, cxN = 0, cyN = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const w = motionMap[y * W + x];
          if (w > 0) { cxN += x * w; cyN += y * w; totalW += w; }
        }
      }
      if (totalW < 1) {
        stateRef.current.busy = false;
        setAnalyzing(false);
        return;
      }
      const cx = cxN / totalW, cy = cyN / totalW;
      const pixels = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const w = motionMap[y * W + x];
          if (w > 0) pixels.push([x, y, w]);
        }
      }
      pixels.sort((a, b) => b[2] - a[2]);
      let minX = W, maxX = 0, minY = H, maxY = 0, cum = 0;
      const target = totalW * 0.75;
      for (const [x, y, w] of pixels) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        cum += w;
        if (cum >= target) break;
      }
      const sx = v.videoWidth / W, sy = v.videoHeight / H;
      const centerX = cx * sx, centerY = cy * sy;
      const boxW = Math.max(20, (maxX - minX) * sx);
      const boxH = Math.max(20, (maxY - minY) * sy);
      const padding = 1.5;
      const zoomX = v.videoWidth  / (boxW * padding);
      const zoomY = v.videoHeight / (boxH * padding);
      const targetZoom = Math.max(2.0, Math.min(5, Math.min(zoomX, zoomY)));

      stateRef.current.scale = targetZoom;
      stateRef.current.offsetX = centerX;
      stateRef.current.offsetY = centerY;
      clampOffset();
      setScaleUI(targetZoom);
      setAutoTagShown(true);
      v.currentTime = 0;
    } catch (e) {
      console.error("[OrphanPreview] analyze fail", e);
    } finally {
      stateRef.current.busy = false;
      setAnalyzing(false);
    }
  }, [clampOffset]);

  // Wire video events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      const s = stateRef.current;
      s.duration = v.duration;
      s.offsetX = v.videoWidth / 2;
      s.offsetY = v.videoHeight / 2;
      s.scale = 2.0;
      setScaleUI(2.0);
      s.loopA = 0;
      s.loopB = v.duration;
      onTrimChangeRef.current?.(0, v.duration, v.duration);
      positionTrimHandles();
      setTimeout(() => analyzeMotion(), 100);
    };
    const onEnded = () => {
      const s = stateRef.current;
      v.currentTime = s.loopA;
      play();
    };
    const onTimeUpdate = () => {
      const s = stateRef.current;
      if (s.playing) {
        const a = Math.min(s.loopA, s.loopB), b = Math.max(s.loopA, s.loopB);
        if (v.currentTime >= b) v.currentTime = a;
      }
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", onEnded);
    v.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("timeupdate", onTimeUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVideo]);

  const positionTrimHandles = useCallback(() => {
    const s = stateRef.current;
    if (!s.duration) return;
    const a = handleARef.current, b = handleBRef.current;
    const trim = stageRef.current?.parentNode?.querySelector(".op-trim");
    if (a) a.style.left = (s.loopA / s.duration * 100) + "%";
    if (b) b.style.left = (s.loopB / s.duration * 100) + "%";
    if (trim) {
      const lo = Math.min(s.loopA, s.loopB), hi = Math.max(s.loopA, s.loopB);
      trim.style.left  = (lo / s.duration * 100) + "%";
      trim.style.width = ((hi - lo) / s.duration * 100) + "%";
    }
  }, []);

  // Playback (with manual-step fallback for sub-floor speeds)
  const startManualPlay = useCallback(() => {
    const v = videoRef.current;
    v.pause();
    stateRef.current.manualPlay = { startTs: performance.now(), startTime: v.currentTime };
    const tick = () => {
      const s = stateRef.current;
      if (!s.playing || !s.manualPlay) return;
      const now = performance.now();
      const elapsed = (now - s.manualPlay.startTs) / 1000;
      let target = s.manualPlay.startTime + elapsed * s.speed;
      const a = Math.min(s.loopA, s.loopB), b = Math.max(s.loopA, s.loopB);
      if (target >= b) {
        target = a;
        s.manualPlay.startTs = now;
        s.manualPlay.startTime = a;
      }
      const tf = Math.round(target * s.fps);
      const cf = Math.round(v.currentTime * s.fps);
      if (tf !== cf) v.currentTime = tf / s.fps;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v || stateRef.current.busy) return;
    const s = stateRef.current;
    const a = Math.min(s.loopA, s.loopB), b = Math.max(s.loopA, s.loopB);
    if (v.currentTime >= b - 0.01 || v.currentTime < a) v.currentTime = a;
    s.playing = true;
    setPlaying(true);
    if (s.speed >= 0.0625) {
      try { v.playbackRate = s.speed; v.play().catch(() => {}); }
      catch { startManualPlay(); }
    } else {
      startManualPlay();
    }
  }, [startManualPlay]);

  const pause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    stateRef.current.playing = false;
    stateRef.current.manualPlay = null;
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (stateRef.current.playing) pause(); else play();
  }, [play, pause]);

  // Pan + zoom
  useEffect(() => {
    if (!hasVideo) return;
    const stage = stageRef.current;
    if (!stage) return;
    let panning = false, lx = 0, ly = 0;
    const onDown = (e) => { if (e.button !== 0) return; panning = true; lx = e.clientX; ly = e.clientY; };
    const onMove = (e) => {
      if (!panning) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      const eff = getEffectiveScale();
      const dpr = window.devicePixelRatio || 1;
      stateRef.current.offsetX -= dx * dpr / eff;
      stateRef.current.offsetY -= dy * dpr / eff;
      clampOffset();
    };
    const onUp = () => { panning = false; };
    const onWheel = (e) => {
      e.preventDefault();
      const c = canvasRef.current;
      if (!c) return;
      const rect = stage.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (c.width / rect.width);
      const my = (e.clientY - rect.top) * (c.height / rect.height);
      const eff0 = getEffectiveScale();
      const cw = c.width, ch = c.height;
      const vx = stateRef.current.offsetX + (mx - cw / 2) / eff0;
      const vy = stateRef.current.offsetY + (my - ch / 2) / eff0;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      stateRef.current.scale = Math.max(0.5, Math.min(8, stateRef.current.scale * factor));
      const eff1 = getEffectiveScale();
      stateRef.current.offsetX = vx - (mx - cw / 2) / eff1;
      stateRef.current.offsetY = vy - (my - ch / 2) / eff1;
      clampOffset();
      setScaleUI(stateRef.current.scale);
    };
    stage.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      stage.removeEventListener("wheel", onWheel);
    };
  }, [hasVideo, getEffectiveScale, clampOffset]);

  // Scrubber + trim drag.
  // Effect depends ONLY on hasVideo so the listeners stay attached for the
  // full lifetime of the loaded clip. Drag state lives in refs above.
  useEffect(() => {
    if (!hasVideo) return;

    // Throttled seek — applied via rAF so rapid mousemoves don't queue up
    // hundreds of v.currentTime= writes (which causes the perceived "stuck").
    const flushSeek = () => {
      seekRafRef.current = null;
      const t = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (t == null) return;
      const v = videoRef.current;
      if (v && isFinite(v.duration)) v.currentTime = t;
    };
    const requestSeek = (t) => {
      pendingSeekRef.current = t;
      if (seekRafRef.current == null) {
        seekRafRef.current = requestAnimationFrame(flushSeek);
      }
    };

    const scrubAtX = (clientX) => {
      const sb = scrubberRef.current;
      if (!sb) return;
      const r = sb.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const v = videoRef.current;
      if (v && isFinite(v.duration)) requestSeek(pct * v.duration);
    };
    const setMarkerAtX = (which, clientX) => {
      const sb = scrubberRef.current, v = videoRef.current;
      if (!sb || !v?.duration) return;
      const r = sb.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const t = pct * v.duration;
      if (which === "A") stateRef.current.loopA = t;
      else stateRef.current.loopB = t;
      // Visual handle update is cheap — do it every move
      positionTrimHandles();
      // Video seek is expensive — throttle to one per frame
      requestSeek(t);
      // Notify parent — using ref so we don't trigger this effect to re-run
      onTrimChangeRef.current?.(stateRef.current.loopA, stateRef.current.loopB, v.duration);
    };

    const onScrubDown = (e) => {
      if (e.target === handleARef.current || e.target === handleBRef.current) return;
      scrubbingRef.current = true;
      pause();
      scrubAtX(e.clientX);
    };
    const onADown = (e) => {
      e.stopPropagation(); e.preventDefault();
      dragMarkerRef.current = "A";
      pause();
      handleARef.current?.classList.add("dragging");
    };
    const onBDown = (e) => {
      e.stopPropagation(); e.preventDefault();
      dragMarkerRef.current = "B";
      pause();
      handleBRef.current?.classList.add("dragging");
    };
    const onMove = (e) => {
      const dm = dragMarkerRef.current;
      if (dm) { setMarkerAtX(dm, e.clientX); return; }
      if (scrubbingRef.current) scrubAtX(e.clientX);
    };
    const onUp = () => {
      if (dragMarkerRef.current) {
        dragMarkerRef.current = null;
        handleARef.current?.classList.remove("dragging");
        handleBRef.current?.classList.remove("dragging");
        // Fire one final settle in case the rAF hasn't flushed
        if (pendingSeekRef.current != null) flushSeek();
      }
      scrubbingRef.current = false;
    };

    // Stash refs at effect-attach time so cleanup detaches from the same nodes
    const sb = scrubberRef.current;
    const ha = handleARef.current;
    const hb = handleBRef.current;

    sb?.addEventListener("mousedown", onScrubDown);
    ha?.addEventListener("mousedown", onADown);
    hb?.addEventListener("mousedown", onBDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      sb?.removeEventListener("mousedown", onScrubDown);
      ha?.removeEventListener("mousedown", onADown);
      hb?.removeEventListener("mousedown", onBDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (seekRafRef.current != null) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVideo]);

  const setSpeed = useCallback((s) => {
    stateRef.current.speed = s;
    setSpeedUI(s);
    if (stateRef.current.playing) {
      pause();
      setTimeout(play, 16);
    }
  }, [play, pause]);

  const fmtFrame = (t) => {
    const f = Math.round(t * stateRef.current.fps);
    return `f${f}`;
  };

  return (
    <>
      <style>{`
        .op-stage {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          border: 1px solid var(--line);
          border-radius: var(--r);
          overflow: hidden;
          cursor: grab;
        }
        .op-stage:active { cursor: grabbing; }
        .op-stage canvas {
          width: 100%; height: 100%; display: block;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }
        .op-stage video { display: none; }
        .op-hud-l, .op-hud-r {
          position: absolute; top: 12px; pointer-events: none; z-index: 5;
        }
        .op-hud-l { left: 12px; }
        .op-hud-r { right: 12px; text-align: right; }
        .op-hud-frame {
          font-family: var(--font-display);
          font-size: 38px; line-height: 1;
          color: var(--accent3); letter-spacing: 1.5px;
          text-shadow: 0 0 16px rgba(0,0,0,0.9);
          font-weight: 700;
        }
        .op-hud-zoom {
          font-family: var(--font-display);
          font-size: 22px; line-height: 1;
          color: var(--text0); letter-spacing: 1px;
          font-weight: 600;
        }
        .op-hud-label {
          font-family: var(--font-mono);
          font-size: 8px; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--text2);
        }
        .op-hud-auto {
          display: inline-block; margin-top: 6px; padding: 1px 6px;
          background: rgba(245,158,11,0.12);
          border: 1px solid var(--gold); color: var(--gold);
          font-family: var(--font-mono); font-size: 8px;
          letter-spacing: 1px; text-transform: uppercase;
          border-radius: 3px;
        }
        .op-analyze-overlay {
          position: absolute; inset: 0; z-index: 6;
          background: rgba(7,8,13,0.7);
          display: grid; place-items: center;
          font-family: var(--font-mono); color: var(--accent3);
          font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
        }
        .op-deck { display: flex; flex-direction: column; gap: 8px; }
        .op-scrubber-row { display: flex; align-items: center; gap: 10px; }
        .op-tport { display: flex; gap: 2px; background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r); padding: 2px; }
        .op-tbtn {
          width: 30px; height: 30px;
          background: transparent; color: var(--text2);
          display: grid; place-items: center;
          border-radius: 3px; font-size: 12px;
          transition: all 0.1s;
        }
        .op-tbtn:hover { background: var(--bg3); color: var(--accent3); }
        .op-tbtn.primary { background: var(--accent); color: var(--bg0); width: 38px; }
        .op-tbtn.primary:hover { background: var(--accent2); }
        .op-scrubber { flex: 1; position: relative; height: 36px; cursor: pointer; user-select: none; }
        .op-track { position: absolute; top: 16px; left: 0; right: 0; height: 4px; background: var(--bg3); border: 1px solid var(--bg4); border-radius: 2px; }
        .op-fill { position: absolute; top: 16px; left: 0; height: 4px; background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 2px; pointer-events: none; }
        .op-trim { position: absolute; top: 16px; height: 4px; background: var(--gold); opacity: 0.45; pointer-events: none; }
        .op-handle-play { position: absolute; top: 8px; width: 3px; height: 20px; background: var(--accent3); transform: translateX(-50%); pointer-events: none; box-shadow: 0 0 8px var(--accent2); }
        .op-handle-trim {
          position: absolute; top: 2px;
          width: 14px; height: 32px;
          background: var(--gold);
          border-radius: 3px;
          transform: translateX(-50%);
          cursor: ew-resize;
          z-index: 3;
          user-select: none;
          display: grid; place-items: center;
          font-family: var(--font-mono); font-size: 9px;
          font-weight: 700; color: var(--bg0);
          box-shadow: 0 0 6px rgba(245,158,11,0.45);
          transition: background 0.1s, box-shadow 0.1s;
        }
        .op-handle-trim:hover { background: #ffb627; box-shadow: 0 0 14px rgba(245,158,11,0.85); }
        .op-handle-trim.dragging {
          background: var(--accent); color: var(--text0);
          box-shadow: 0 0 18px rgba(99,102,241,0.7);
          transform: translateX(-50%) scale(1.08);
        }
        .op-handle-trim::after { content: ""; position: absolute; top: 25%; bottom: 25%; left: 50%; width: 1px; background: rgba(0,0,0,0.35); transform: translateX(-50%); }
        .op-tc { font-family: var(--font-mono); font-size: 12px; color: var(--text0); min-width: 100px; text-align: right; }
        .op-tc .total { color: var(--text3); margin-left: 4px; }
        .op-pillgrp { display: flex; background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
        .op-pill {
          padding: 5px 10px; background: transparent; color: var(--text2);
          font-family: var(--font-mono); font-size: 10px;
          letter-spacing: 1px; text-transform: uppercase; font-weight: 500;
          border-right: 1px solid var(--line); transition: all 0.1s;
        }
        .op-pill:last-child { border-right: none; }
        .op-pill:hover { color: var(--accent3); }
        .op-pill.active { background: var(--accent); color: var(--bg0); font-weight: 700; }
        .op-controls-row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
        .op-trim-info {
          font-family: var(--font-mono); font-size: 10px;
          color: var(--gold); letter-spacing: 0.5px;
          margin-left: auto;
        }
      `}</style>

      <div className="op-deck">
        <div ref={stageRef} className="op-stage">
          <video ref={videoRef} muted playsInline preload="auto" />
          <canvas ref={canvasRef} />
          <div className="op-hud-l">
            <div className="op-hud-frame">{Math.round((stateRef.current.duration > 0 ? (videoRef.current?.currentTime || 0) : 0) * stateRef.current.fps).toString().padStart(3, "0")}</div>
            <div className="op-hud-label">Frame</div>
          </div>
          <div className="op-hud-r">
            <div className="op-hud-zoom">{scaleUI.toFixed(1)}×</div>
            <div className="op-hud-label">Magnify</div>
            {autoTagShown && <div className="op-hud-auto">Auto-zoom</div>}
          </div>
          {analyzing && (
            <div className="op-analyze-overlay">
              Analyzing motion · {Math.round(analyzeProgress * 100)}%
            </div>
          )}
        </div>

        <div className="op-scrubber-row">
          <div className="op-tport">
            <button className="op-tbtn primary" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
            <button className="op-tbtn" onClick={() => { pause(); const v = videoRef.current; v.currentTime = Math.max(0, v.currentTime - 1 / stateRef.current.fps); }}>◀</button>
            <button className="op-tbtn" onClick={() => { pause(); const v = videoRef.current; v.currentTime = Math.min(v.duration, v.currentTime + 1 / stateRef.current.fps); }}>▶</button>
          </div>

          <div ref={scrubberRef} className="op-scrubber">
            <div className="op-track" />
            <div className="op-fill" />
            <div className="op-trim" />
            <div ref={handleARef} className="op-handle-trim" title="Drag to set start">A</div>
            <div ref={handleBRef} className="op-handle-trim" title="Drag to set end">B</div>
            <div className="op-handle-play" />
          </div>
        </div>

        <div className="op-controls-row">
          <div className="op-pillgrp">
            {[
              { v: 1,    l: "1×"   },
              { v: 0.5,  l: "½"    },
              { v: 0.25, l: "¼"    },
              { v: 0.1,  l: "⅒"    },
              { v: 0.05, l: "1/20" },
            ].map(p => (
              <button key={p.v}
                      className={`op-pill ${speedUI === p.v ? "active" : ""}`}
                      onClick={() => setSpeed(p.v)}>{p.l}</button>
            ))}
          </div>
          <span className="op-trim-info">
            Trim: {fmtFrame(stateRef.current.loopA)} → {fmtFrame(stateRef.current.loopB)}
            {" "}({Math.round((stateRef.current.loopB - stateRef.current.loopA) * stateRef.current.fps)} frames)
          </span>
        </div>
      </div>
    </>
  );
});


// ============================================================
// § 13 — COMPARE TAB
// ============================================================

// ============================================================
// § 13e — UNIFIED COMPARISON TAB
// ============================================================

/**
 * Merged Compare + Kill Comparison tab.
 * Mode A — Head-to-Head: pick two characters, compare all stats side-by-side
 *           with a radar chart and best-combo flowcharts.
 * Mode B — Global Kill Comparison: full-roster kill confirm analysis
 *           with filters (hits, move type, percent range) and 4 chart modes.
 */
function CompareTab() {
  const { state } = useApp();
  const { combos } = state;
  const [mode, setMode] = useState("h2h"); // "h2h" | "global"

  // ── Head-to-Head state ────────────────────────────────────
  const [charA, setCharA] = useState(ENUM.Characters[0]);
  const [charB, setCharB] = useState(ENUM.Characters[1]);
  const [h2hChart, setH2hChart] = useState("stats"); // "stats" | "radar" | "flowA" | "flowB"

  // ── Global Kill state ─────────────────────────────────────
  const [minHits,    setMinHits]    = useState(1);
  const [maxHits,    setMaxHits]    = useState(10);
  const [moveFilter, setMoveFilter] = useState("All");
  const [minPct,     setMinPct]     = useState(0);
  const [maxPct,     setMaxPct]     = useState(200);
  const [chartMode,  setChartMode]  = useState("count");
  const [sortKey,    setSortKey]    = useState("kills");
  const [sortDir,    setSortDir]    = useState("desc");

  const RADAR_COLORS = ["#6366f1","#f59e0b","#22c55e","#ec4899","#06b6d4","#a855f7"];

  // ── H2H helpers ───────────────────────────────────────────
  const charStats = (char) => {
    const cs = combos.filter(c => c.character === char);
    if (!cs.length) return null;
    const kills = cs.filter(c => c.killConfirm);
    return {
      count:      cs.length,
      avgDmg:     Math.round(cs.reduce((s, c) => s + c.totalDamage, 0) / cs.length),
      maxDmg:     Math.max(...cs.map(c => c.totalDamage)),
      killCount:  kills.length,
      killMaxDmg: kills.length ? Math.max(...kills.map(c => c.totalDamage)) : 0,
      killMinPct: kills.length ? Math.min(...kills.map(c => c.startPercent)) : null,
      avgMoves:   Math.round(cs.reduce((s, c) => s + c.sequence.length, 0) / cs.length),
      grounded:   cs.filter(c => c.sequence.every(m => m.moveType === "Grounded")).length,
      aerial:     cs.filter(c => c.sequence.some(m => m.moveType === "Aerial")).length,
      bestCombo:  cs.reduce((a, b) => a.totalDamage > b.totalDamage ? a : b),
      bestKill:   kills.length ? kills.reduce((a, b) => a.totalDamage > b.totalDamage ? a : b) : null,
    };
  };

  const sA = useMemo(() => charStats(charA), [charA, combos]);
  const sB = useMemo(() => charStats(charB), [charB, combos]);

  // Radar data for H2H
  const h2hRadarData = useMemo(() => {
    if (!sA || !sB) return [];
    const maxDmg   = Math.max(sA.maxDmg, sB.maxDmg, 1);
    const maxCount = Math.max(sA.count,  sB.count,  1);
    const maxKills = Math.max(sA.killCount, sB.killCount, 1);
    const maxMoves = Math.max(sA.avgMoves, sB.avgMoves, 1);
    return [
      { metric: "Combo Count",   [charA]: Math.round(sA.count/maxCount*100),      [charB]: Math.round(sB.count/maxCount*100) },
      { metric: "Max Damage",    [charA]: Math.round(sA.maxDmg/maxDmg*100),       [charB]: Math.round(sB.maxDmg/maxDmg*100) },
      { metric: "Kill Confirms", [charA]: Math.round(sA.killCount/maxKills*100),   [charB]: Math.round(sB.killCount/maxKills*100) },
      { metric: "Kill Damage",   [charA]: Math.round(sA.killMaxDmg/maxDmg*100),   [charB]: Math.round(sB.killMaxDmg/maxDmg*100) },
      { metric: "Efficiency",    [charA]: Math.round((1-sA.avgMoves/maxMoves)*100+40), [charB]: Math.round((1-sB.avgMoves/maxMoves)*100+40) },
      { metric: "Grounded",      [charA]: Math.round(sA.grounded/Math.max(sA.count,1)*100), [charB]: Math.round(sB.grounded/Math.max(sB.count,1)*100) },
      { metric: "Aerial",        [charA]: Math.round(sA.aerial/Math.max(sA.count,1)*100),   [charB]: Math.round(sB.aerial/Math.max(sB.count,1)*100) },
    ];
  }, [sA, sB, charA, charB]);

  // ── Global Kill helpers ───────────────────────────────────
  const killCombos = useMemo(() => combos.filter(c => c.killConfirm), [combos]);

  const filteredKills = useMemo(() => killCombos.filter(c => {
    const hits = c.sequence.length;
    if (hits < minHits || hits > maxHits) return false;
    if (minPct > 0 && c.startPercent < minPct) return false;
    if (maxPct < 200 && c.startPercent > maxPct) return false;
    if (moveFilter === "Grounded" && !c.sequence.every(m => m.moveType === "Grounded")) return false;
    if (moveFilter === "Aerial"   && !c.sequence.some(m => m.moveType === "Aerial"))    return false;
    if (moveFilter === "Grab"     && !c.sequence.some(m => m.buttonInput === "Grab" || m.buttonInput === "Throw")) return false;
    return true;
  }), [killCombos, minHits, maxHits, moveFilter, minPct, maxPct]);

  const globalCharData = useMemo(() => {
    const map = {};
    filteredKills.forEach(c => {
      if (!map[c.character]) map[c.character] = {
        character: c.character, kills: 0, totalDmg: 0, maxDmg: 0,
        minStartPct: 999, totalMoves: 0, grounded: 0, aerial: 0, grabRoutes: 0,
      };
      const r = map[c.character];
      r.kills++; r.totalDmg += c.totalDamage; r.totalMoves += c.sequence.length;
      if (c.totalDamage > r.maxDmg) r.maxDmg = c.totalDamage;
      if (c.startPercent < r.minStartPct) r.minStartPct = c.startPercent;
      if (c.sequence.every(m => m.moveType === "Grounded")) r.grounded++;
      if (c.sequence.some(m => m.moveType === "Aerial"))    r.aerial++;
      if (c.sequence.some(m => m.buttonInput === "Grab" || m.buttonInput === "Throw")) r.grabRoutes++;
    });
    return Object.values(map).map(r => ({ ...r, avgDmg: Math.round(r.totalDmg/r.kills), avgMoves: parseFloat((r.totalMoves/r.kills).toFixed(1)) }));
  }, [filteredKills]);

  const globalSorted = useMemo(() => [...globalCharData].sort((a,b) => {
    const va = a[sortKey]??0, vb = b[sortKey]??0;
    return sortDir === "desc" ? vb-va : va-vb;
  }), [globalCharData, sortKey, sortDir]);

  const globalChartData = useMemo(() => globalSorted.slice(0,12).map(r => ({
    name: r.character.split(" ")[0], fullName: r.character,
    kills: r.kills, maxDmg: r.maxDmg, avgDmg: r.avgDmg, avgMoves: r.avgMoves,
    grounded: r.grounded, aerial: r.aerial, minStartPct: r.minStartPct,
  })), [globalSorted]);

  const globalRadarData = useMemo(() => {
    const top = globalSorted.slice(0,6);
    if (top.length < 2) return [];
    const maxK = Math.max(...top.map(r=>r.kills),1);
    const maxD = Math.max(...top.map(r=>r.maxDmg),1);
    const maxM = Math.max(...top.map(r=>r.avgMoves),1);
    const maxG = Math.max(...top.map(r=>r.grounded),1);
    const maxA = Math.max(...top.map(r=>r.aerial),1);
    return [
      { metric: "Kill Routes",    ...Object.fromEntries(top.map(r=>[r.character, Math.round(r.kills/maxK*100)])) },
      { metric: "Max Damage",     ...Object.fromEntries(top.map(r=>[r.character, Math.round(r.maxDmg/maxD*100)])) },
      { metric: "Efficiency",     ...Object.fromEntries(top.map(r=>[r.character, Math.round((1-r.avgMoves/(maxM+1))*100)])) },
      { metric: "Grounded",       ...Object.fromEntries(top.map(r=>[r.character, Math.round(r.grounded/maxG*100)])) },
      { metric: "Aerial",         ...Object.fromEntries(top.map(r=>[r.character, Math.round(r.aerial/maxA*100)])) },
      { metric: "Early Kill %",   ...Object.fromEntries(top.map(r=>[r.character, r.minStartPct<80?100:r.minStartPct<120?60:30])) },
    ];
  }, [globalSorted]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const SortTh = ({ label, k }) => (
    <th style={{ cursor:"pointer", userSelect:"none", whiteSpace:"nowrap" }} onClick={() => toggleSort(k)}>
      {label}{sortKey===k && <span style={{ marginLeft:4, color:"var(--accent3)" }}>{sortDir==="desc"?"↓":"↑"}</span>}
    </th>
  );

  // Stat row used in H2H comparison table
  const StatRow = ({ label, vA, vB, col, higherIsBetter = true }) => {
    const numA = parseFloat(vA), numB = parseFloat(vB);
    const aWins = !isNaN(numA) && !isNaN(numB) && (higherIsBetter ? numA > numB : numA < numB);
    const bWins = !isNaN(numA) && !isNaN(numB) && (higherIsBetter ? numB > numA : numB < numA);
    return (
      <tr>
        <td style={{ color: aWins ? "var(--text0)" : "var(--text2)", fontWeight: aWins ? 700 : 400, fontFamily:"var(--font-mono)" }}>{vA ?? "—"}</td>
        <td style={{ textAlign:"center", fontSize:12, color:"var(--text3)", padding:"8px 4px" }}>{label}</td>
        <td style={{ color: bWins ? "var(--text0)" : "var(--text2)", fontWeight: bWins ? 700 : 400, fontFamily:"var(--font-mono)", textAlign:"right" }}>{vB ?? "—"}</td>
      </tr>
    );
  };

  return (
    <div>
      {/* ── Mode switcher ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div className="page-title" style={{ marginBottom:0 }}>
          {mode === "h2h" ? <><span>Head-to-Head</span> Compare</> : <>Global Kill <span>Comparison</span></>}
        </div>
        <div style={{ display:"flex", gap:6, background:"var(--bg2)", border:"1px solid var(--line)", borderRadius:"var(--r2)", padding:4 }}>
          <button onClick={() => setMode("h2h")}
            style={{ padding:"7px 18px", borderRadius:"var(--r)", fontFamily:"var(--font-display)", fontSize:13, fontWeight:600, letterSpacing:1, textTransform:"uppercase", cursor:"pointer", border:"none",
              background: mode==="h2h" ? "var(--accent)" : "transparent",
              color: mode==="h2h" ? "#fff" : "var(--text2)",
              transition:"all 0.2s" }}>
            ⚔ Head-to-Head
          </button>
          <button onClick={() => setMode("global")}
            style={{ padding:"7px 18px", borderRadius:"var(--r)", fontFamily:"var(--font-display)", fontSize:13, fontWeight:600, letterSpacing:1, textTransform:"uppercase", cursor:"pointer", border:"none",
              background: mode==="global" ? "var(--red)" : "transparent",
              color: mode==="global" ? "#fff" : "var(--text2)",
              transition:"all 0.2s" }}>
            🎯 Kill Comparison
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          MODE A — HEAD TO HEAD
          ════════════════════════════════════════════════════════ */}
      {mode === "h2h" && (
        <div>
          {/* Character pickers */}
          <div className="card" style={{ marginBottom:20 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 60px 1fr", gap:12, alignItems:"end" }}>
              <div className="field">
                <label>Character A</label>
                <select value={charA} onChange={e => setCharA(e.target.value)}>
                  {ENUM.Characters.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ textAlign:"center", paddingBottom:8, fontFamily:"var(--font-display)", fontSize:20, fontWeight:700, color:"var(--text3)" }}>vs</div>
              <div className="field">
                <label>Character B</label>
                <select value={charB} onChange={e => setCharB(e.target.value)}>
                  {ENUM.Characters.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* View mode pills */}
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[
              { id:"stats",  label:"Stats Table" },
              { id:"radar",  label:"Radar Chart"  },
              { id:"flowA",  label:`${charA.split(" ")[0]} Best Combo` },
              { id:"flowB",  label:`${charB.split(" ")[0]} Best Combo` },
            ].map(opt => (
              <button key={opt.id} className={`char-pill ${h2hChart===opt.id?"active":""}`}
                style={{ fontSize:12, padding:"5px 14px" }}
                onClick={() => setH2hChart(opt.id)}>{opt.label}</button>
            ))}
          </div>

          {/* Stats table view */}
          {h2hChart === "stats" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {/* Side-by-side stat comparison */}
              <div className="card" style={{ gridColumn:"1/-1" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 140px 1fr", alignItems:"center", marginBottom:14 }}>
                  <div style={{ fontFamily:"var(--font-display)", fontSize:20, fontWeight:700, color:charColor(charA) }}>{charA}</div>
                  <div style={{ textAlign:"center", fontSize:11, color:"var(--text3)", letterSpacing:2, textTransform:"uppercase" }}>Metric</div>
                  <div style={{ fontFamily:"var(--font-display)", fontSize:20, fontWeight:700, color:charColor(charB), textAlign:"right" }}>{charB}</div>
                </div>
                {(!sA && !sB) ? (
                  <div style={{ color:"var(--text3)", textAlign:"center", padding:"24px 0", fontSize:13 }}>Neither character has combos recorded yet.</div>
                ) : (
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <tbody>
                      <StatRow label="Total Combos"   vA={sA?.count}      vB={sB?.count} />
                      <StatRow label="Max Damage"      vA={sA ? sA.maxDmg+"%"  : null} vB={sB ? sB.maxDmg+"%"  : null} />
                      <StatRow label="Avg Damage"      vA={sA ? sA.avgDmg+"%"  : null} vB={sB ? sB.avgDmg+"%"  : null} />
                      <StatRow label="Kill Confirms"   vA={sA?.killCount}  vB={sB?.killCount} />
                      <StatRow label="Best Kill Dmg"   vA={sA?.killMaxDmg ? sA.killMaxDmg+"%" : "—"} vB={sB?.killMaxDmg ? sB.killMaxDmg+"%" : "—"} />
                      <StatRow label="Earliest Kill"   vA={sA?.killMinPct != null ? sA.killMinPct+"%" : "—"} vB={sB?.killMinPct != null ? sB.killMinPct+"%" : "—"} higherIsBetter={false} />
                      <StatRow label="Avg Move Count"  vA={sA?.avgMoves}   vB={sB?.avgMoves} higherIsBetter={false} />
                      <StatRow label="Grounded Routes" vA={sA?.grounded}   vB={sB?.grounded} />
                      <StatRow label="Aerial Routes"   vA={sA?.aerial}     vB={sB?.aerial} />
                    </tbody>
                  </table>
                )}
              </div>

              {/* Best combo strips */}
              {[{char:charA, s:sA}, {char:charB, s:sB}].map(({char, s}) => (
                <div key={char} className="card">
                  <div style={{ fontFamily:"var(--font-display)", fontSize:15, fontWeight:700, color:charColor(char), marginBottom:10 }}>
                    {char} — Best Combo
                  </div>
                  {s ? (
                    <>
                      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                        <span style={{ fontFamily:"var(--font-mono)", color:"var(--gold)", fontWeight:700 }}>{s.bestCombo.totalDamage}%</span>
                        {s.bestCombo.killConfirm && <span className="badge badge-kill" style={{ fontSize:10 }}>✦ KILL</span>}
                      </div>
                      <MoveStrip sequence={s.bestCombo.sequence} />
                      {s.bestKill && s.bestKill.id !== s.bestCombo.id && (
                        <>
                          <div style={{ fontFamily:"var(--font-display)", fontSize:13, color:"var(--red)", margin:"12px 0 6px" }}>Best Kill Confirm</div>
                          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                            <span style={{ fontFamily:"var(--font-mono)", color:"var(--gold)", fontWeight:700 }}>{s.bestKill.totalDamage}%</span>
                            <span className="badge badge-kill" style={{ fontSize:10 }}>✦ KILL</span>
                          </div>
                          <MoveStrip sequence={s.bestKill.sequence} />
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{ color:"var(--text3)", fontSize:13 }}>No combos recorded.</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Radar view */}
          {h2hChart === "radar" && (
            <div className="card">
              <div className="card-title">Multi-Metric Radar — {charA} vs {charB}</div>
              {(!sA || !sB) ? (
                <div style={{ color:"var(--text3)", padding:24, textAlign:"center", fontSize:13 }}>Both characters need combo data to show radar.</div>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <RadarChart data={h2hRadarData} margin={{ top:20, right:40, left:40, bottom:20 }}>
                    <PolarGrid stroke="rgba(99,102,241,0.2)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill:"#94a3b8", fontSize:12, fontFamily:"Exo 2" }} />
                    <PolarRadiusAxis angle={90} domain={[0,100]} tick={{ fill:"#475569", fontSize:9 }} />
                    <Radar name={charA} dataKey={charA} stroke={charColor(charA)} fill={charColor(charA)} fillOpacity={0.15} strokeWidth={2} />
                    <Radar name={charB} dataKey={charB} stroke={charColor(charB)} fill={charColor(charB)} fillOpacity={0.15} strokeWidth={2} />
                    <Legend wrapperStyle={{ color:"var(--text2)", fontFamily:"Exo 2", fontSize:13 }} />
                    <Tooltip contentStyle={{ background:"var(--bg3)", border:"1px solid rgba(99,102,241,0.3)", borderRadius:8, fontFamily:"Exo 2" }} />
                  </RadarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Flowchart views */}
          {(h2hChart === "flowA" || h2hChart === "flowB") && (() => {
            const char = h2hChart === "flowA" ? charA : charB;
            const s    = h2hChart === "flowA" ? sA : sB;
            return (
              <div className="card">
                <div className="card-title">{char} — Best Combo Flowchart</div>
                {s ? <ComboFlowchart combo={s.bestCombo} height={260} /> : (
                  <div style={{ color:"var(--text3)", padding:24, textAlign:"center", fontSize:13 }}>No combos recorded for {char}.</div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODE B — GLOBAL KILL COMPARISON
          ════════════════════════════════════════════════════════ */}
      {mode === "global" && (
        <div>
          {/* Summary stats */}
          <div className="stat-grid" style={{ marginBottom:20 }}>
            {[
              { value: filteredKills.length,  label:"Matching Routes",   sub:"after filters",       col:"var(--red)"     },
              { value: globalCharData.length,  label:"Characters",        sub:"with kill confirms",  col:"var(--accent3)" },
              { value: globalSorted[0]?.kills ?? 0, label:"Most Routes", sub:globalSorted[0]?.character??"—", col:"var(--gold)" },
              { value: (globalSorted.reduce((a,b)=>a.maxDmg>b.maxDmg?a:b,{maxDmg:0,character:"—"}).maxDmg||0)+"%",
                label:"Highest Kill Dmg", sub:globalSorted.reduce((a,b)=>a.maxDmg>b.maxDmg?a:b,{maxDmg:0,character:"—"}).character, col:"var(--cyan)" },
              { value: (globalSorted.reduce((a,b)=>a.minStartPct<b.minStartPct?a:b,{minStartPct:999,character:"—"}).minStartPct||"—")+"%",
                label:"Earliest Kill",   sub:globalSorted.reduce((a,b)=>a.minStartPct<b.minStartPct?a:b,{minStartPct:999,character:"—"}).character, col:"var(--green)" },
            ].map((s,i) => (
              <div key={i} className="stat-tile" style={{ borderColor:s.col+"40" }}>
                <div className="stat-value" style={{ color:s.col, textShadow:`0 0 20px ${s.col}60` }}>{s.value}</div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-sub" style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <div className="card" style={{ marginBottom:20, padding:"16px 20px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:14 }}>
              <span style={{ fontFamily:"var(--font-display)", fontSize:12, color:"var(--text2)", letterSpacing:2, textTransform:"uppercase" }}>Filters</span>
              {(minHits>1||maxHits<10||moveFilter!=="All"||minPct>0||maxPct<200) && (
                <button className="btn btn-ghost btn-sm" style={{ marginLeft:8, fontSize:11 }}
                  onClick={() => { setMinHits(1); setMaxHits(10); setMoveFilter("All"); setMinPct(0); setMaxPct(200); }}>✕ Reset</button>
              )}
              <span style={{ marginLeft:"auto", fontSize:12, color:"var(--text3)", fontFamily:"var(--font-mono)" }}>
                {filteredKills.length} routes · {globalCharData.length} chars
              </span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:14 }}>
              <div className="field">
                <label>Start Type</label>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:2 }}>
                  {["All","Grounded","Aerial","Grab"].map(opt => (
                    <button key={opt} className={`char-pill ${moveFilter===opt?"active":""}`}
                      style={{ fontSize:12,
                        ...(moveFilter===opt&&opt==="Grounded"?{borderColor:"#22c55e",color:"#22c55e",background:"#22c55e18"}:{}),
                        ...(moveFilter===opt&&opt==="Aerial"  ?{borderColor:"#06b6d4",color:"#06b6d4",background:"#06b6d418"}:{}),
                        ...(moveFilter===opt&&opt==="Grab"    ?{borderColor:"#ec4899",color:"#ec4899",background:"#ec489918"}:{}),
                      }}
                      onClick={() => setMoveFilter(opt)}>{opt}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Min Hits: <span style={{ color:"var(--accent3)", fontFamily:"var(--font-mono)" }}>{minHits}</span></label>
                <input type="range" min="1" max="10" value={minHits} onChange={e=>setMinHits(Number(e.target.value))} style={{ width:"100%", accentColor:"var(--accent)", marginTop:6 }} />
              </div>
              <div className="field">
                <label>Max Hits: <span style={{ color:"var(--accent3)", fontFamily:"var(--font-mono)" }}>{maxHits===10?"Any":maxHits}</span></label>
                <input type="range" min="1" max="10" value={maxHits} onChange={e=>setMaxHits(Number(e.target.value))} style={{ width:"100%", accentColor:"var(--accent)", marginTop:6 }} />
              </div>
              <div className="field">
                <label>Kill from: <span style={{ color:"var(--cyan)", fontFamily:"var(--font-mono)" }}>{minPct}%</span></label>
                <input type="range" min="0" max="200" step="5" value={minPct} onChange={e=>setMinPct(Number(e.target.value))} style={{ width:"100%", accentColor:"var(--cyan)", marginTop:6 }} />
              </div>
              <div className="field">
                <label>Kill until: <span style={{ color:"var(--cyan)", fontFamily:"var(--font-mono)" }}>{maxPct>=200?"Any":maxPct+"%"}</span></label>
                <input type="range" min="0" max="200" step="5" value={maxPct} onChange={e=>setMaxPct(Number(e.target.value))} style={{ width:"100%", accentColor:"var(--cyan)", marginTop:6 }} />
              </div>
            </div>
          </div>

          {killCombos.length===0 ? (
            <div className="empty"><div className="empty-icon">🎯</div><div className="empty-text">No kill confirms in database yet</div></div>
          ) : globalCharData.length===0 ? (
            <div className="empty"><div className="empty-icon">🔍</div><div className="empty-text">No results match filters</div><div className="empty-sub">Try adjusting the filters above</div></div>
          ) : (
            <>
              {/* Chart mode pills */}
              <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
                {[
                  {id:"count",    label:"Route Count"    },
                  {id:"damage",   label:"Max / Avg Dmg"  },
                  {id:"avgMoves", label:"Hits to Kill"   },
                  {id:"radar",    label:"Radar Profile"  },
                ].map(opt => (
                  <button key={opt.id} className={`char-pill ${chartMode===opt.id?"active":""}`}
                    style={{ fontSize:12, padding:"5px 14px" }} onClick={() => setChartMode(opt.id)}>{opt.label}</button>
                ))}
              </div>

              {/* Charts */}
              <div className="card" style={{ marginBottom:20 }}>
                {chartMode==="count" && (
                  <>
                    <div className="card-title">Kill Confirm Routes per Character</div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={globalChartData} margin={{ top:4, right:16, left:-10, bottom:70 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                        <XAxis dataKey="name" tick={{ fill:"#94a3b8", fontSize:10, fontFamily:"Exo 2" }} angle={-40} textAnchor="end" interval={0} />
                        <YAxis tick={{ fill:"#94a3b8", fontSize:10, fontFamily:"JetBrains Mono" }} allowDecimals={false} />
                        <Tooltip contentStyle={{ background:"var(--bg3)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:8, fontFamily:"Exo 2" }}
                          labelFormatter={(_,p)=>p?.[0]?.payload?.fullName||""} formatter={v=>[v,"Kill Routes"]} cursor={{ fill:"rgba(239,68,68,0.06)" }} />
                        <Bar dataKey="kills" radius={[5,5,0,0]}>
                          {globalChartData.map((e,i) => <Cell key={i} fill={charColor(e.fullName)} opacity={0.85} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                )}
                {chartMode==="damage" && (
                  <>
                    <div className="card-title">Max & Average Kill Confirm Damage</div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={globalChartData} margin={{ top:4, right:16, left:-10, bottom:70 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                        <XAxis dataKey="name" tick={{ fill:"#94a3b8", fontSize:10, fontFamily:"Exo 2" }} angle={-40} textAnchor="end" interval={0} />
                        <YAxis tick={{ fill:"#94a3b8", fontSize:10, fontFamily:"JetBrains Mono" }} unit="%" />
                        <Tooltip contentStyle={{ background:"var(--bg3)", border:"1px solid rgba(245,158,11,0.3)", borderRadius:8, fontFamily:"Exo 2" }}
                          labelFormatter={(_,p)=>p?.[0]?.payload?.fullName||""} formatter={(v,n)=>[v+"%",n]} cursor={{ fill:"rgba(245,158,11,0.05)" }} />
                        <Legend wrapperStyle={{ color:"var(--text2)", fontFamily:"Exo 2", fontSize:12, paddingTop:8 }} />
                        <Bar dataKey="maxDmg" name="Max Damage" fill="#f59e0b" radius={[4,4,0,0]} opacity={0.85} />
                        <Bar dataKey="avgDmg" name="Avg Damage" fill="#6366f1" radius={[4,4,0,0]} opacity={0.75} />
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                )}
                {chartMode==="avgMoves" && (
                  <>
                    <div className="card-title">Average Hits to Kill (lower = more efficient)</div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={[...globalChartData].sort((a,b)=>a.avgMoves-b.avgMoves)} margin={{ top:4, right:16, left:-10, bottom:70 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                        <XAxis dataKey="name" tick={{ fill:"#94a3b8", fontSize:10, fontFamily:"Exo 2" }} angle={-40} textAnchor="end" interval={0} />
                        <YAxis tick={{ fill:"#94a3b8", fontSize:10, fontFamily:"JetBrains Mono" }} />
                        <Tooltip contentStyle={{ background:"var(--bg3)", border:"1px solid rgba(6,182,212,0.3)", borderRadius:8, fontFamily:"Exo 2" }}
                          labelFormatter={(_,p)=>p?.[0]?.payload?.fullName||""} formatter={v=>[v,"Avg Hits"]} cursor={{ fill:"rgba(6,182,212,0.05)" }} />
                        <Bar dataKey="avgMoves" radius={[5,5,0,0]}>
                          {[...globalChartData].sort((a,b)=>a.avgMoves-b.avgMoves).map((_,i)=><Cell key={i} fill="#06b6d4" opacity={1-i*0.05} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                )}
                {chartMode==="radar" && (
                  <>
                    <div className="card-title">Multi-Metric Kill Profile — Top 6 Characters</div>
                    {globalSorted.length<2 ? (
                      <div style={{ color:"var(--text3)", padding:24, textAlign:"center", fontSize:13 }}>Need at least 2 characters with kill confirms.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={340}>
                        <RadarChart data={globalRadarData} margin={{ top:16, right:40, left:40, bottom:16 }}>
                          <PolarGrid stroke="rgba(99,102,241,0.2)" />
                          <PolarAngleAxis dataKey="metric" tick={{ fill:"#94a3b8", fontSize:11, fontFamily:"Exo 2" }} />
                          <PolarRadiusAxis angle={90} domain={[0,100]} tick={{ fill:"#475569", fontSize:9 }} />
                          {globalSorted.slice(0,6).map((r,i) => (
                            <Radar key={r.character} name={r.character} dataKey={r.character}
                              stroke={RADAR_COLORS[i]} fill={RADAR_COLORS[i]} fillOpacity={0.12} strokeWidth={2} />
                          ))}
                          <Legend wrapperStyle={{ color:"var(--text2)", fontFamily:"Exo 2", fontSize:12 }} />
                          <Tooltip contentStyle={{ background:"var(--bg3)", border:"1px solid rgba(99,102,241,0.3)", borderRadius:8, fontFamily:"Exo 2" }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    )}
                  </>
                )}
              </div>

              {/* Leaderboard */}
              <div className="card" style={{ padding:0, overflow:"hidden" }}>
                <div style={{ padding:"14px 20px 10px", borderBottom:"1px solid var(--line)", display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontFamily:"var(--font-display)", fontSize:13, color:"var(--text2)", letterSpacing:2, textTransform:"uppercase" }}>Leaderboard</span>
                  <span style={{ fontSize:12, color:"var(--text3)", fontFamily:"var(--font-mono)" }}>{globalSorted.length} characters</span>
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table className="compare-table" style={{ fontSize:13 }}>
                    <thead>
                      <tr>
                        <th style={{ width:36 }}>#</th>
                        <th>Character</th>
                        <SortTh label="Routes"      k="kills"       />
                        <SortTh label="Max Dmg"     k="maxDmg"      />
                        <SortTh label="Avg Dmg"     k="avgDmg"      />
                        <SortTh label="Avg Hits"    k="avgMoves"    />
                        <SortTh label="Earliest %"  k="minStartPct" />
                        <th>Grounded</th>
                        <th>Aerial</th>
                        <th>Grab</th>
                        <th>Damage Bar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globalSorted.map((r,i) => (
                        <tr key={r.character}>
                          <td style={{ fontFamily:"var(--font-mono)", color:i<3?["#f59e0b","#94a3b8","#b45309"][i]:"var(--text3)", fontWeight:i<3?700:400 }}>
                            {i<3?["🥇","🥈","🥉"][i]:i+1}
                          </td>
                          <td><span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:14, color:charColor(r.character) }}>{r.character}</span></td>
                          <td><span style={{ fontFamily:"var(--font-mono)", color:"var(--red)", fontWeight:700 }}>{r.kills}</span></td>
                          <td><span style={{ fontFamily:"var(--font-mono)", color:"var(--gold)", fontWeight:700 }}>{r.maxDmg}%</span></td>
                          <td><span style={{ fontFamily:"var(--font-mono)", color:"var(--accent3)" }}>{r.avgDmg}%</span></td>
                          <td><span style={{ fontFamily:"var(--font-mono)", color:"var(--cyan)" }}>{r.avgMoves}</span></td>
                          <td><span style={{ fontFamily:"var(--font-mono)", color:r.minStartPct<80?"var(--green)":"var(--text2)" }}>{r.minStartPct===999?"—":r.minStartPct+"%"}</span></td>
                          <td>{r.grounded>0?<span className="badge" style={{ background:"rgba(34,197,94,0.12)",color:"#22c55e",border:"1px solid rgba(34,197,94,0.25)",fontSize:10 }}>{r.grounded}</span>:<span style={{color:"var(--text3)"}}>—</span>}</td>
                          <td>{r.aerial>0?<span className="badge" style={{ background:"rgba(6,182,212,0.12)",color:"#06b6d4",border:"1px solid rgba(6,182,212,0.25)",fontSize:10 }}>{r.aerial}</span>:<span style={{color:"var(--text3)"}}>—</span>}</td>
                          <td>{r.grabRoutes>0?<span className="badge" style={{ background:"rgba(236,72,153,0.12)",color:"#ec4899",border:"1px solid rgba(236,72,153,0.25)",fontSize:10 }}>{r.grabRoutes}</span>:<span style={{color:"var(--text3)"}}>—</span>}</td>
                          <td style={{ minWidth:120 }}>
                            <div className="prog-bar-wrap">
                              <div className="prog-bar" style={{ width:`${Math.round(r.maxDmg/Math.max(...globalSorted.map(x=>x.maxDmg),1)*100)}%`, background:`linear-gradient(90deg,${charColor(r.character)},var(--red))` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ============================================================
// § 13b — FLOWCHARTS TAB
// ============================================================

/**
 * Dedicated full-screen flowchart browser.
 * Left panel: filterable combo list.
 * Right panel: full interactive flowchart + metadata.
 */
function FlowchartsTab() {
  const { state, dispatch } = useApp();
  const { combos } = state;
  const [filterChar, setFilterChar] = useState("All");
  const [search, setSearch]         = useState("");
  const [activeId, setActiveId]     = useState(combos[0]?.id || null);

  const presentChars = useMemo(() =>
    ["All", ...new Set(combos.map(c => c.character))], [combos]);

  const filtered = useMemo(() => combos.filter(c => {
    const charOk = filterChar === "All" || c.character === filterChar;
    const searchOk = search === "" ||
      c.character.toLowerCase().includes(search.toLowerCase()) ||
      (c.notes || "").toLowerCase().includes(search.toLowerCase()) ||
      c.sequence.some(m => (m.label || "").toLowerCase().includes(search.toLowerCase()));
    return charOk && searchOk;
  }), [combos, filterChar, search]);

  const activeCombo = combos.find(c => c.id === activeId) || filtered[0] || null;

  // Auto-select first when filter changes
  useEffect(() => {
    if (!filtered.find(c => c.id === activeId) && filtered.length > 0)
      setActiveId(filtered[0].id);
  }, [filtered]);

  return (
    <div>
      <div className="page-title">Combo <span>Flowcharts</span></div>
      <div className="fc-tab-grid">

        {/* ── Left: combo picker ── */}
        <div className="card" style={{ padding: 16 }}>
          {/* Search */}
          <div className="field" style={{ marginBottom: 12 }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search combos, moves…"
              style={{ background: "var(--bg3)", border: "1px solid var(--bg4)", borderRadius: "var(--r)", padding: "8px 12px", color: "var(--text0)", fontSize: 13, width: "100%" }} />
          </div>

          {/* Character filter */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
            {presentChars.map(c => (
              <button key={c} className={`char-pill ${filterChar === c ? "active" : ""}`}
                style={{ fontSize: 11, padding: "3px 9px",
                  ...(filterChar === c && c !== "All" ? { borderColor: charColor(c), color: charColor(c), background: charColor(c) + "18" } : {}) }}
                onClick={() => setFilterChar(c)}>{c}</button>
            ))}
          </div>

          {/* List */}
          <div className="scroll-list" style={{ maxHeight: 520 }}>
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <div className="empty-icon">🔍</div>
                <div className="empty-text" style={{ fontSize: 16 }}>No results</div>
              </div>
            ) : filtered.map(combo => (
              <div key={combo.id}
                className={`fc-combo-item ${combo.id === activeId ? "active" : ""}`}
                onClick={() => setActiveId(combo.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: charColor(combo.character) }}>
                    {combo.character}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--gold)", fontWeight: 700 }}>
                    {combo.totalDamage}%
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className={`badge ${combo.killConfirm ? "badge-kill" : "badge-combo"}`} style={{ fontSize: 10 }}>
                    {combo.killConfirm ? "✦ KILL" : "Combo"}
                  </span>
                  <span className="badge badge-pct" style={{ fontSize: 10 }}>
                    {combo.startPercent}–{combo.endPercent === 999 ? "∞" : combo.endPercent}%
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                    {combo.sequence.length} moves
                  </span>
                </div>
                {combo.notes && (
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {combo.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: flowchart viewer ── */}
        <div className="card">
          {activeCombo ? (
            <>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: charColor(activeCombo.character), lineHeight: 1.1 }}>
                    {activeCombo.character}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <span className={`badge ${activeCombo.killConfirm ? "badge-kill" : "badge-combo"}`}>
                      {activeCombo.killConfirm ? "✦ Kill Confirm" : "Combo"}
                    </span>
                    <span className="badge badge-pct">
                      {activeCombo.startPercent}–{activeCombo.endPercent === 999 ? "∞" : activeCombo.endPercent}%
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gold)", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 4, padding: "2px 8px" }}>
                      {activeCombo.totalDamage}% dmg
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {/* Quick nav */}
                  <button className="btn btn-ghost btn-sm" disabled={filtered.indexOf(activeCombo) <= 0}
                    onClick={() => { const i = filtered.indexOf(activeCombo); if (i > 0) setActiveId(filtered[i-1].id); }}>
                    ← Prev
                  </button>
                  <span style={{ fontSize: 12, color: "var(--text3)", alignSelf: "center", fontFamily: "var(--font-mono)" }}>
                    {filtered.indexOf(activeCombo) + 1} / {filtered.length}
                  </span>
                  <button className="btn btn-ghost btn-sm" disabled={filtered.indexOf(activeCombo) >= filtered.length - 1}
                    onClick={() => { const i = filtered.indexOf(activeCombo); if (i < filtered.length - 1) setActiveId(filtered[i+1].id); }}>
                    Next →
                  </button>
                </div>
              </div>

              {/* Notes */}
              {activeCombo.notes && (
                <div style={{ background: "var(--bg3)", borderRadius: "var(--r)", padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--text1)", borderLeft: "3px solid var(--accent)" }}>
                  {activeCombo.notes}
                </div>
              )}

              {/* THE FLOWCHART */}
              <ComboFlowchart combo={activeCombo} height={280} />

              {/* Move table */}
              <hr className="divider" />
              <div className="card-title">Move Breakdown</div>
              <div style={{ overflowX: "auto" }}>
                <table className="compare-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>#</th><th>Label</th><th>Input</th><th>Direction</th>
                      <th>Type</th><th>Opp. DI</th><th>Kill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCombo.sequence.map((move, i) => (
                      <tr key={move.id || i}>
                        <td style={{ fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>{i + 1}</td>
                        <td style={{ fontWeight: 600, color: "var(--text0)" }}>{move.label || "—"}</td>
                        <td>
                          <span style={{ color: NODE_COLORS[move.buttonInput]?.stroke, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                            {move.buttonInput}
                          </span>
                        </td>
                        <td style={{ color: "var(--cyan)", fontFamily: "var(--font-mono)" }}>{move.inputDirection}</td>
                        <td style={{ color: "var(--text2)" }}>{move.moveType}</td>
                        <td style={{ color: move.diDirection !== "None" ? "#ef4444" : "var(--text3)", fontFamily: "var(--font-mono)" }}>
                          {move.diDirection}
                        </td>
                        <td>
                          {move.killConfirm
                            ? <span className="badge badge-kill" style={{ fontSize: 10 }}>✦ YES</span>
                            : <span style={{ color: "var(--text3)" }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: "80px 24px" }}>
              <div className="empty-icon">◈</div>
              <div className="empty-text">Select a Combo</div>
              <div className="empty-sub">Choose any combo from the left panel</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// § 13c — KILL CONFIRMS TAB
// ============================================================

function KillConfirmsTab() {
  const { state, dispatch } = useApp();
  const { combos } = state;

  const [filterChar, setFilterChar] = useState("All");
  const [sortKey, setSortKey]       = useState("damage");   // "damage" | "percent" | "moves"
  const [sortDir, setSortDir]       = useState("desc");
  const [activeId, setActiveId]     = useState(null);

  // Only kill-confirm combos
  const killCombos = useMemo(() => combos.filter(c => c.killConfirm), [combos]);
  const presentChars = useMemo(() => ["All", ...new Set(killCombos.map(c => c.character))], [killCombos]);

  const sorted = useMemo(() => {
    let list = filterChar === "All" ? killCombos : killCombos.filter(c => c.character === filterChar);
    list = [...list].sort((a, b) => {
      let va, vb;
      if (sortKey === "damage")  { va = a.totalDamage;       vb = b.totalDamage; }
      if (sortKey === "percent") { va = a.startPercent;      vb = b.startPercent; }
      if (sortKey === "moves")   { va = a.sequence.length;   vb = b.sequence.length; }
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return list;
  }, [killCombos, filterChar, sortKey, sortDir]);

  const activeCombo = combos.find(c => c.id === activeId);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortHeader = ({ label, k }) => (
    <th style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      onClick={() => toggleSort(k)}>
      {label}
      {sortKey === k && <span style={{ marginLeft: 4, color: "var(--accent3)" }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );

  // Aggregate stats
  const stats = useMemo(() => {
    if (!killCombos.length) return null;
    const byChar = {};
    killCombos.forEach(c => {
      if (!byChar[c.character]) byChar[c.character] = { count: 0, maxDmg: 0, minPct: 999 };
      byChar[c.character].count++;
      if (c.totalDamage > byChar[c.character].maxDmg) byChar[c.character].maxDmg = c.totalDamage;
      if (c.startPercent < byChar[c.character].minPct) byChar[c.character].minPct = c.startPercent;
    });
    return {
      total: killCombos.length,
      chars: Object.keys(byChar).length,
      maxDmg: Math.max(...killCombos.map(c => c.totalDamage)),
      earliest: Math.min(...killCombos.map(c => c.startPercent)),
      avgMoves: Math.round(killCombos.reduce((s, c) => s + c.sequence.length, 0) / killCombos.length),
      byChar,
    };
  }, [killCombos]);

  if (killCombos.length === 0) return (
    <div>
      <div className="page-title">Kill <span>Confirms</span></div>
      <div className="empty" style={{ padding: "80px 24px" }}>
        <div className="empty-icon">🎯</div>
        <div className="empty-text">No Kill Confirms Yet</div>
        <div className="empty-sub">Add combos in the Builder and mark them as Kill Confirms</div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-title">Kill <span>Confirms</span></div>

      {/* ── Stats row ── */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {[
          { value: stats.total,          label: "Kill Confirms",   sub: "total routes",       col: "var(--red)"     },
          { value: stats.chars,          label: "Characters",      sub: "with kill confirms",  col: "var(--accent3)" },
          { value: stats.maxDmg + "%",   label: "Highest Damage",  sub: "kill confirm route",  col: "var(--gold)"    },
          { value: stats.earliest + "%", label: "Earliest Kill",   sub: "lowest start percent",col: "var(--cyan)"    },
          { value: stats.avgMoves,       label: "Avg Move Count",  sub: "per kill route",      col: "var(--green)"   },
        ].map((s, i) => (
          <div className="stat-tile" key={i} style={{ borderColor: s.col + "40" }}>
            <div className="stat-value" style={{ color: s.col, textShadow: `0 0 20px ${s.col}60` }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>

        {/* ── Left: table + filters ── */}
        <div>
          {/* Filter + sort bar */}
          <div className="card" style={{ marginBottom: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>Character</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {presentChars.map(c => (
                  <button key={c} className={`char-pill ${filterChar === c ? "active" : ""}`}
                    style={{ fontSize: 11, padding: "3px 10px",
                      ...(filterChar === c && c !== "All" ? { borderColor: charColor(c), color: charColor(c), background: charColor(c) + "18" } : {}) }}
                    onClick={() => setFilterChar(c)}>{c}</button>
                ))}
              </div>
              <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text3)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                {sorted.length} route{sorted.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>

          {/* Kill confirms table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="compare-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Character</th>
                    <SortHeader label="Damage"   k="damage"  />
                    <SortHeader label="Start %"  k="percent" />
                    <th>End %</th>
                    <SortHeader label="Moves"    k="moves"   />
                    <th>Sequence</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(combo => (
                    <tr key={combo.id}
                      style={{ cursor: "pointer", background: activeId === combo.id ? "rgba(239,68,68,0.06)" : "transparent" }}
                      onClick={() => setActiveId(activeId === combo.id ? null : combo.id)}>
                      <td>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: charColor(combo.character), fontSize: 14 }}>
                          {combo.character}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--gold)", fontSize: 15 }}>
                          {combo.totalDamage}%
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--cyan)" }}>{combo.startPercent}%</span>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text2)" }}>
                          {combo.endPercent === 999 ? "∞" : combo.endPercent + "%"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>{combo.sequence.length}</span>
                      </td>
                      <td style={{ maxWidth: 200 }}>
                        <MoveStrip sequence={combo.sequence} />
                      </td>
                      <td style={{ color: "var(--text3)", fontSize: 12, maxWidth: 160, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {combo.notes || "—"}
                      </td>
                      <td>
                        <button className="icon-btn" title="Delete"
                          onClick={e => {
                            e.stopPropagation();
                            dispatch({ type: "DELETE_COMBO", payload: combo.id });
                            if (activeId === combo.id) setActiveId(null);
                          }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-character summary cards */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--text2)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
              By Character
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
              {Object.entries(stats.byChar)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([char, s]) => (
                  <div key={char}
                    className="card"
                    style={{ padding: "12px 14px", cursor: "pointer", borderColor: filterChar === char ? charColor(char) + "80" : undefined }}
                    onClick={() => setFilterChar(filterChar === char ? "All" : char)}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: charColor(char), marginBottom: 6 }}>
                      {char}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--text3)" }}>Routes</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--red)" }}>{s.count}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span style={{ color: "var(--text3)" }}>Max dmg</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--gold)" }}>{s.maxDmg}%</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span style={{ color: "var(--text3)" }}>Kills from</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--cyan)" }}>{s.minPct}%</span>
                    </div>
                    <div className="prog-bar-wrap" style={{ marginTop: 8 }}>
                      <div className="prog-bar" style={{
                        width: `${Math.round(s.maxDmg / stats.maxDmg * 100)}%`,
                        background: `linear-gradient(90deg, ${charColor(char)}, var(--red))`
                      }} />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ── Right: flowchart detail panel ── */}
        <div>
          <div className="card" style={{ position: "sticky", top: 80 }}>
            {activeCombo ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 20 }}>🎯</span>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: charColor(activeCombo.character) }}>
                    {activeCombo.character}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  <span className="badge badge-kill">✦ Kill Confirm</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gold)", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 4, padding: "2px 8px" }}>
                    {activeCombo.totalDamage}% dmg
                  </span>
                  <span className="badge badge-pct">
                    {activeCombo.startPercent}–{activeCombo.endPercent === 999 ? "∞" : activeCombo.endPercent}%
                  </span>
                </div>

                {activeCombo.notes && (
                  <div style={{ background: "var(--bg3)", borderRadius: "var(--r)", padding: "9px 12px", marginBottom: 14, fontSize: 12, color: "var(--text1)", borderLeft: "3px solid var(--red)" }}>
                    {activeCombo.notes}
                  </div>
                )}

                <div className="card-title" style={{ marginBottom: 10 }}>Flowchart</div>
                <ComboFlowchart combo={activeCombo} height={220} />

                <hr className="divider" />
                <div className="card-title" style={{ marginBottom: 8 }}>Kill Moves</div>
                {activeCombo.sequence.filter(m => m.killConfirm).length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>No individual moves flagged — full sequence is the confirm.</div>
                ) : activeCombo.sequence.filter(m => m.killConfirm).map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--r)", marginBottom: 6 }}>
                    <span style={{ color: "#ef4444", fontSize: 16 }}>✦</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text0)" }}>{m.label || `${m.inputDirection} ${m.buttonInput}`}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{m.moveType} · DI {m.diDirection}</div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="empty" style={{ padding: "48px 16px" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
                <div className="empty-text" style={{ fontSize: 16 }}>Select a row</div>
                <div className="empty-sub">Click any kill confirm to view its flowchart</div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ============================================================
// § 14 — APP SHELL
// ============================================================

const TABS = [
  { id: "dashboard",   label: "Dashboard"      },
  { id: "builder",     label: "Builder"        },
  { id: "flowcharts",  label: "Flowcharts"     },
  { id: "kills",       label: "Kill Confirms"  },
  { id: "compare",     label: "Compare"        },
  { id: "analytics",   label: "Analytics"      },
  { id: "framedata",   label: "Frame Data"     },
  { id: "data",        label: "Import / Export"},
];

function AppShell() {
  const { state, dispatch } = useApp();

  return (
    <div className="app">
      <div className="grid-bg" />
      {/* Header */}
      <header className="header">
        <div className="logo">
          MV<span>SI</span>
          <sub>Combo Intelligence</sub>
        </div>
        <nav className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={`tab-btn ${state.activeTab === t.id ? "active" : ""}`}
              onClick={() => dispatch({ type: "SET_TAB", payload: t.id })}>
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ fontSize: 12, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
          {state.combos.length} combos
        </div>
      </header>

      {/* Content */}
      <main className="content">
        {state.activeTab === "dashboard" && <Dashboard />}
        {state.activeTab === "builder"   && <ComboBuilder />}
        {state.activeTab === "flowcharts" && <FlowchartsTab />}
        {state.activeTab === "kills"      && <KillConfirmsTab />}
        {state.activeTab === "analytics" && <Analytics />}
        {state.activeTab === "compare"   && <CompareTab />}
        {state.activeTab === "framedata" && <FrameDataTab />}
        {state.activeTab === "data"      && <ImportExport />}
      </main>

      <ToastStack />
    </div>
  );
}

// ============================================================
// § 15 — ENTRY POINT
// ============================================================

export default function MVSI() {
  return (
    <>
      <style>{STYLES}</style>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </>
  );
}
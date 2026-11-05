// Verzeichnis der Reaktionen. Reihenfolge = Reihenfolge im Menü.
// `lk: true` markiert Inhalte, die (vorläufig) nur im Leistungskurs vorgesehen
// sind – bitte mit dem Kernlehrplan abgleichen und hier anpassen.

import { Esterification } from './esterification.js';
import { SN1 } from './sn1.js';
import { E1 } from './e1.js';
import { SN2 } from './sn2.js';
import { Addition } from './addition.js';
import { RadicalSubstitution } from './radical.js';
import { SEAr } from './sear.js';

export const REACTIONS = [Esterification, SN1, SN2, E1, Addition, RadicalSubstitution, SEAr];

/** Geplante Reaktionen: erscheinen im Menü als „in Vorbereitung“ */
export const PLANNED = [];

export const reactionById = (id) => REACTIONS.find((r) => r.id === id) || null;

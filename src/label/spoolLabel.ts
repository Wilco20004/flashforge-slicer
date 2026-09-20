/**
 * Turning a spool into what LabelForge wants: a bag of text variables, plus
 * the options for the one image the template can carry.
 *
 * Everything here is pure — the image is described, not drawn — so the mapping
 * can be tested without a canvas. The caller renders it with
 * {@link spoolArtPng} and puts the result under {@link SpoolLabelPlan.imageVariable}.
 */
import type { Spool } from '../profiles/spools';
import { remainingG, remainingFraction, spoolMaterial, spoolName } from '../profiles/spools';
import type { LabelTemplate } from './labelforge';
import type { SpoolArtOptions } from './spoolArt';

/** The text variables a template can use, for the UI to list. */
export const SPOOL_LABEL_VARIABLES: { name: string; example: string; what: string }[] = [
  { name: 'name', example: 'eSUN PLA · Galaxy Black', what: 'Brand, material and colour in one line' },
  { name: 'brand', example: 'eSUN', what: 'Manufacturer' },
  { name: 'material', example: 'PLA', what: 'From the filament preset the spool is based on' },
  { name: 'color', example: 'Galaxy Black', what: "The manufacturer's colour name" },
  { name: 'color_hex', example: '#1a1a1a', what: 'Colour as hex, for when the patch prints as a grey tone' },
  { name: 'nozzle_temp', example: '220', what: 'Nozzle temperature in °C, number only' },
  { name: 'bed_temp', example: '55', what: 'Bed temperature in °C, number only' },
  { name: 'temps', example: '220 / 55 °C', what: 'Nozzle and bed together' },
  { name: 'weight', example: '1000 g', what: 'Filament on a full spool' },
  { name: 'used', example: '260 g', what: 'Printed so far' },
  { name: 'remaining', example: '740 g', what: 'Left on the spool' },
  { name: 'remaining_pct', example: '74%', what: 'Left, as a percentage' },
  { name: 'id', example: 'K7M2QX', what: 'The spool id, also carried in the QR code' },
  { name: 'purchased', example: '2026-03-14', what: 'Purchase date, blank when not recorded' },
  { name: 'notes', example: 'Dried 6h @ 50°C', what: 'Free text from the spool' },
  { name: 'link', example: 'http://…/#spool=K7M2QX', what: 'Exactly what the QR code encodes' },
];

/** What the QR code carries: the spool id, behind the configured prefix. */
export function spoolQrText(s: Spool, prefix: string): string {
  return `${(prefix ?? '').trim()}${s.id}`;
}

export function spoolTextVariables(s: Spool, qrText: string): Record<string, string> {
  const fraction = remainingFraction(s);
  return {
    name: spoolName(s),
    brand: s.brand,
    material: spoolMaterial(s),
    color: s.colorName,
    color_hex: s.color,
    nozzle_temp: String(Math.round(s.nozzleTemp)),
    bed_temp: String(Math.round(s.bedTemp)),
    temps: `${Math.round(s.nozzleTemp)} / ${Math.round(s.bedTemp)} °C`,
    weight: s.netWeightG > 0 ? `${Math.round(s.netWeightG)} g` : '',
    used: `${Math.round(s.usedG)} g`,
    remaining: s.netWeightG > 0 ? `${Math.round(remainingG(s))} g` : '',
    remaining_pct: fraction === null ? '' : `${Math.round(fraction * 100)}%`,
    id: s.id,
    purchased: s.purchasedAt,
    notes: s.notes,
    link: qrText,
  };
}

export interface SpoolLabelPlan {
  /** Text variables, ready to post. The image still has to be added. */
  variables: Record<string, string>;
  /** Which variable takes the image, or null when this template cannot carry one. */
  imageVariable: string | null;
  /** How to draw that image, or null when there is nowhere to put it. */
  art: SpoolArtOptions | null;
  /** Anything about this combination the user should know before printing. */
  warnings: string[];
}

export function planSpoolLabel(s: Spool, template: LabelTemplate, qrPrefix: string): SpoolLabelPlan {
  const qrText = spoolQrText(s, qrPrefix);
  const variables = spoolTextVariables(s, qrText);
  const warnings: string[] = [];

  // Variables the template asks for that a spool has nothing to say about: the
  // render would silently substitute an empty string, which reads as a design
  // mistake on the finished label rather than as a missing value.
  const unknown = template.variables.filter((v) => v !== template.image_variable && !(v in variables));
  if (unknown.length) {
    warnings.push(`This template asks for ${unknown.map((v) => `{{${v}}}`).join(', ')}, which a spool does not provide — those will print blank.`);
  }

  let art: SpoolArtOptions | null = null;
  const imageVariable = template.image_variable;
  if (imageVariable && template.image) {
    art = {
      width: template.image.width,
      height: template.image.height,
      qrText,
      color: s.color,
    };
  } else if (template.image) {
    warnings.push("The template's image has no override variable, so the QR code and colour patch cannot be supplied. Give the image a variable name in LabelForge.");
  } else {
    warnings.push('The template has no image block, so this label is text only. Add one in LabelForge for the QR code and colour patch.');
  }

  return { variables, imageVariable, art, warnings };
}

/**
 * What Bambu Studio and the printer know a filament and a printer by, which Orca's presets don't carry the same way.
 * Both are from Bambu Studio's own profiles (resources/profiles/BBL: `filament_id` of each X2D filament, `model_id`
 * of the X2D). Studio matches a sliced file's filaments to the AMS by their `tray_info_idx` (the filament's id), and
 * refuses to send a file to a printer whose model id isn't the file's `printer_model_id`.
 */

/** Studio's `model_id` of each printer model (`Bambu Lab X2D.json`: "N6"). */
export const BAMBU_PRINTER_MODEL_IDS: Readonly<Record<string, string>> = { "Bambu Lab X2D": "N6" };

/** The X2D's filaments' ids in Bambu Studio's profiles, by the preset's name without its "@BBL X2D …" suffix. */
const FILAMENT_IDS: Readonly<Record<string, string>> = {
  "Bambu ABS": "GFB00",
  "Bambu ABS-GF": "GFB50",
  "Bambu ASA": "GFB01",
  "Bambu ASA-Aero": "GFB02",
  "Bambu ASA-CF": "GFB51",
  "Bambu PA-CF": "GFN03",
  "Bambu PA6-CF": "GFN05",
  "Bambu PA6-GF": "GFN08",
  "Bambu PAHT-CF": "GFN04",
  "Bambu PC": "GFC00",
  "Bambu PC FR": "GFC01",
  "Bambu PET-CF": "GFT01",
  "Bambu PETG Basic": "GFG00",
  "Bambu PETG HF": "GFG02",
  "Bambu PETG Matte": "GFG03",
  "Bambu PETG Translucent": "GFG01",
  "Bambu PETG-CF": "GFG50",
  "Bambu PLA Aero": "GFA11",
  "Bambu PLA Basic": "GFA00",
  "Bambu PLA Dynamic": "GFA13",
  "Bambu PLA Galaxy": "GFA15",
  "Bambu PLA Glow": "GFA12",
  "Bambu PLA Lite": "GFA18",
  "Bambu PLA Marble": "GFA07",
  "Bambu PLA Matte": "GFA01",
  "Bambu PLA Metal": "GFA02",
  "Bambu PLA Palette": "GFA20",
  "Bambu PLA Pure": "GFA19",
  "Bambu PLA Silk": "GFA05",
  "Bambu PLA Silk+": "GFA06",
  "Bambu PLA Sparkle": "GFA08",
  "Bambu PLA Tough": "GFA09",
  "Bambu PLA Tough+": "GFA10",
  "Bambu PLA Translucent": "GFA17",
  "Bambu PLA Wood": "GFA16",
  "Bambu PLA-CF": "GFA50",
  "Bambu PPA-CF": "GFN06",
  "Bambu PVA": "GFS04",
  "Bambu Support For PA/PET": "GFS03",
  "Bambu Support For PLA": "GFS02",
  "Bambu Support For PLA/PETG": "GFS05",
  "Bambu Support G": "GFS01",
  "Bambu Support W": "GFS00",
  "Bambu Support for ABS": "GFS06",
  "Bambu TPU 85A": "GFU04",
  "Bambu TPU 90A": "GFU03",
  "Bambu TPU 95A": "GFU01",
  "Bambu TPU 95A HF": "GFU00",
  "Bambu TPU for AMS": "GFU02",
  "Generic ABS": "GFB99",
  "Generic ASA": "GFB98",
  "Generic BVOH": "GFS97",
  "Generic EVA": "GFR99",
  "Generic HIPS": "GFS98",
  "Generic PA": "GFN99",
  "Generic PA-CF": "GFN98",
  "Generic PC": "GFC99",
  "Generic PCTG": "GFG97",
  "Generic PE": "GFP99",
  "Generic PE-CF": "GFP98",
  "Generic PETG": "GFG99",
  "Generic PETG HF": "GFG96",
  "Generic PETG-CF": "GFG98",
  "Generic PHA": "GFR98",
  "Generic PLA": "GFL99",
  "Generic PLA High Speed": "GFL95",
  "Generic PLA Silk": "GFL96",
  "Generic PLA-CF": "GFL98",
  "Generic PP": "GFP97",
  "Generic PP-CF": "GFP96",
  "Generic PP-GF": "GFP95",
  "Generic PPA-CF": "GFN97",
  "Generic PPA-GF": "GFN96",
  "Generic PVA": "GFS99",
  "Generic TPU": "GFU99",
  "Generic TPU for AMS": "GFU98",
};

/** "Bambu PLA Basic @BBL X2D 0.4 nozzle" → "GFA00": the id Studio's own preset has, "" for a filament it hasn't. */
export function bambuFilamentId(presetName: string): string {
  return FILAMENT_IDS[presetName.replace(/ @BBL X2D.*$/, "")] ?? "";
}

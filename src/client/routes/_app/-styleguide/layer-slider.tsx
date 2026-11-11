import { useState } from "react";
import { LayerSlider } from "@/components/ui/LayerSlider";
import { Panel, Section } from "./shared";

/** The layer slider: scrubbing a print's layers, with the live marker of a print in progress. */
export function LayerSliderSection() {
  const [layer, setLayer] = useState(112);
  const [live, setLive] = useState(168);
  return (
    <Section
      id="layer-slider"
      title="Layer slider"
      note="Scrubs the 3D view's layers under the thumb. A real range input, so arrow keys, Home and End work. The semolina tick marks how far a running print has got."
    >
      <Panel className="flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-small text-ink-soft tabular">Layer {layer + 1} of 317</span>
          <LayerSlider
            label="Layer"
            value={layer}
            max={316}
            onChange={setLayer}
            valueText={`Layer ${layer + 1} of 317`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-small text-ink-soft tabular">While it prints: layer {live + 1}</span>
          <LayerSlider
            label="Layer of the print in progress"
            value={live}
            max={316}
            onChange={setLive}
            live={168}
            valueText={`Layer ${live + 1} of 317, the print has reached layer 169`}
          />
        </div>
      </Panel>
    </Section>
  );
}

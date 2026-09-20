import { address } from '@solana/kit';

import { CLOSING_COPY } from '../../../../../../copy/banners.js';
import { buildUnwindAndClose } from '../../../../../../server/positions/buildOwnerAction.js';
import { answerAnOwnerAction } from '../../../../../../server/positions/ownerRoute.js';
import {
  estimateWhatClosingNeeds,
  readOnePosition,
} from '../../../../../../server/positions/readPositions.js';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return answerAnOwnerAction(
    'positions/unwind/build',
    id,
    async ({ stored, inputs, steps }) => {
      const positionAddress = stored.positionAddress ?? '';
      const reading = await readOnePosition(address(positionAddress));
      const outcome = await buildUnwindAndClose(inputs, steps);
      if ('refused' in outcome || reading === null) {
        return outcome;
      }
      const estimate = await steps.at('quoting what closing needs', () =>
        estimateWhatClosingNeeds(
          reading,
          BigInt(reading.destinationRaw),
          stored.feeBpsAtOpen,
        ),
      );
      return {
        built: outcome.built,
        extra: {
          closing: {
            sentence: CLOSING_COPY.shortfallSentence,
            estimateLabel: CLOSING_COPY.estimateLabel,
            ...estimate,
          },
          position: reading,
        },
      };
    },
  );
}

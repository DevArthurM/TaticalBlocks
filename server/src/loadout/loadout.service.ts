import { BadRequestException, Injectable } from '@nestjs/common';
import { DEFAULT_LOADOUT, type Loadout, type LoadoutValidation, validateLoadout } from '../../../shared/weapons';

/** Guarda o loadout do jogador em memória (fase de testes, jogador único). */
@Injectable()
export class LoadoutService {
  private current: Loadout = structuredClone(DEFAULT_LOADOUT);

  get(): Loadout {
    return this.current;
  }

  validate(input: Partial<Loadout>): LoadoutValidation {
    return validateLoadout(input ?? {});
  }

  save(input: Partial<Loadout>): Loadout {
    const result = this.validate(input);
    if (!result.valid) throw new BadRequestException({ message: 'Loadout inválido', errors: result.errors });
    this.current = result.loadout;
    return this.current;
  }

  reset(): Loadout {
    this.current = structuredClone(DEFAULT_LOADOUT);
    return this.current;
  }
}

import { itemPrice, START_MONEY, START_WEAPONS } from '@shared/weapons/economy';

/**
 * Dinheiro e itens comprados no modo zumbis. No solo o saldo é local; online o
 * servidor guarda o saldo (`remote` envia a compra e devolve o resultado).
 */
export class Economy {
  money = START_MONEY;
  private readonly weapons = new Set<string>(START_WEAPONS);
  private readonly attachments = new Set<string>();
  private busy = false;
  /** Online: compra no servidor. */
  remote: ((item: string) => Promise<{ ok: boolean; money: number }>) | null = null;
  /** Saldo ou itens mudaram (HUD/loja). */
  onChange: () => void = () => {};
  /** Ganhou dinheiro (aviso "+$60"). */
  onEarn: (amount: number) => void = () => {};

  ownsWeapon(id: string): boolean {
    return this.weapons.has(id);
  }

  ownsAttachment(weapon: string, att: string): boolean {
    return this.attachments.has(`${weapon}:${att}`);
  }

  canAfford(item: string): boolean {
    const p = itemPrice(item);
    return p !== null && p <= this.money && !this.busy;
  }

  /** Tenta comprar; true se deu certo (o item passa a ser do jogador). */
  async buy(item: string): Promise<boolean> {
    const price = itemPrice(item);
    if (price === null || price > this.money || this.busy) return false;
    let ok = true;
    if (this.remote) {
      this.busy = true;
      try {
        const r = await this.remote(item);
        ok = r.ok;
        this.money = r.money;
      } catch {
        ok = false;
      } finally {
        this.busy = false;
      }
    } else this.money -= price;
    if (ok) {
      const [kind, id, att] = item.split(':');
      if (kind === 'w') this.weapons.add(id);
      if (kind === 'a') this.attachments.add(`${id}:${att}`);
    }
    this.onChange();
    return ok;
  }

  /** Solo: recompensa por abate. */
  earn(amount: number): void {
    this.money += amount;
    this.onEarn(amount);
    this.onChange();
  }

  /** Online: saldo vindo do servidor (aviso quando aumenta). */
  setMoney(value: number): void {
    if (value === this.money) return;
    if (value > this.money && !this.busy) this.onEarn(value - this.money);
    this.money = value;
    this.onChange();
  }
}

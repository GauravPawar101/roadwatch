export interface KeyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class InMemoryKeyStore implements KeyStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class ReactNativeKeychainKeyStore implements KeyStore {
  private readonly service: string;

  constructor(service: string) {
    this.service = service;
  }

  private get keychain(): any {
    // Deliberately required dynamically so non-RN tooling (web builds/typecheck) doesn't choke.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-keychain');
  }

  async get(key: string): Promise<string | null> {
    const credentials = await this.keychain.getGenericPassword({ service: this.service + ':' + key });
    if (!credentials) return null;
    return credentials.password as string;
  }

  async set(key: string, value: string): Promise<void> {
    await this.keychain.setGenericPassword('roadwatch', value, {
      service: this.service + ':' + key,
      accessible: this.keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  }

  async remove(key: string): Promise<void> {
    await this.keychain.resetGenericPassword({ service: this.service + ':' + key });
  }
}

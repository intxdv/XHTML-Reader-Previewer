export interface ReaderPreferences {
  theme: 'dark' | 'light' | 'sepia';
  fontSize: number;
  fontFamily: 'serif' | 'sans' | 'mono';
  lineHeight: 'normal' | 'relaxed' | 'tight';
  readerWidth: 'normal' | 'wide' | 'compact';
  readerMode: 'scroll' | 'paginated';
}

export interface ReadingLocation {
  scrollRatio: number;
  scrollY: number;
  anchorId?: string;
  timestamp: number;
}

export interface HistoryLocation {
  uri: string;
  chapterTitle?: string;
  scrollY: number;
  scrollRatio: number;
  anchorId?: string;
  isPaginated?: boolean;
}

export class NavigationHistory {
  private backStack: HistoryLocation[] = [];
  private forwardStack: HistoryLocation[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }

  push(location: HistoryLocation): void {
    this.backStack.push(location);
    if (this.backStack.length > this.maxDepth) {
      this.backStack.shift();
    }
    // When a new jump occurs, clear forward stack
    this.forwardStack = [];
  }

  canGoBack(): boolean {
    return this.backStack.length > 0;
  }

  canGoForward(): boolean {
    return this.forwardStack.length > 0;
  }

  peekBack(): HistoryLocation | undefined {
    return this.backStack.length > 0 ? this.backStack[this.backStack.length - 1] : undefined;
  }

  peekForward(): HistoryLocation | undefined {
    return this.forwardStack.length > 0 ? this.forwardStack[this.forwardStack.length - 1] : undefined;
  }

  goBack(currentLocation: HistoryLocation): HistoryLocation | undefined {
    const target = this.backStack.pop();
    if (target) {
      this.forwardStack.push(currentLocation);
      if (this.forwardStack.length > this.maxDepth) {
        this.forwardStack.shift();
      }
    }
    return target;
  }

  goForward(currentLocation: HistoryLocation): HistoryLocation | undefined {
    const target = this.forwardStack.pop();
    if (target) {
      this.backStack.push(currentLocation);
      if (this.backStack.length > this.maxDepth) {
        this.backStack.shift();
      }
    }
    return target;
  }

  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }

  getBackCount(): number {
    return this.backStack.length;
  }

  getForwardCount(): number {
    return this.forwardStack.length;
  }
}

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  theme: 'dark',
  fontSize: 18,
  fontFamily: 'serif',
  lineHeight: 'normal',
  readerWidth: 'normal',
  readerMode: 'scroll'
};

const PREFERENCES_KEY = 'xhtmlReader.preferences';
const LOCATIONS_KEY = 'xhtmlReader.locations';
const MAX_SAVED_LOCATIONS = 200;

export class StateManager {
  constructor(private readonly storage: MementoLike) {}

  getPreferences(): ReaderPreferences {
    const saved = this.storage.get<Partial<ReaderPreferences>>(PREFERENCES_KEY, {});
    return {
      theme: saved.theme === 'light' || saved.theme === 'sepia' || saved.theme === 'dark' ? saved.theme : DEFAULT_PREFERENCES.theme,
      fontSize: typeof saved.fontSize === 'number' && saved.fontSize >= 12 && saved.fontSize <= 32 ? saved.fontSize : DEFAULT_PREFERENCES.fontSize,
      fontFamily: saved.fontFamily === 'serif' || saved.fontFamily === 'sans' || saved.fontFamily === 'mono' ? saved.fontFamily : DEFAULT_PREFERENCES.fontFamily,
      lineHeight: saved.lineHeight === 'normal' || saved.lineHeight === 'relaxed' || saved.lineHeight === 'tight' ? saved.lineHeight : DEFAULT_PREFERENCES.lineHeight,
      readerWidth: saved.readerWidth === 'normal' || saved.readerWidth === 'wide' || saved.readerWidth === 'compact' ? saved.readerWidth : DEFAULT_PREFERENCES.readerWidth,
      readerMode: saved.readerMode === 'paginated' ? 'paginated' : 'scroll'
    };
  }

  async savePreferences(patch: Partial<ReaderPreferences>): Promise<void> {
    const current = this.getPreferences();
    const updated: ReaderPreferences = { ...current, ...patch };
    await this.storage.update(PREFERENCES_KEY, updated);
  }

  getReadingLocation(uri: string): ReadingLocation | undefined {
    const locations = this.storage.get<Record<string, ReadingLocation>>(LOCATIONS_KEY, {});
    return locations[uri];
  }

  async saveReadingLocation(uri: string, location: Omit<ReadingLocation, 'timestamp'>): Promise<void> {
    const locations = { ...this.storage.get<Record<string, ReadingLocation>>(LOCATIONS_KEY, {}) };
    locations[uri] = {
      ...location,
      timestamp: Date.now()
    };

    // Prune oldest entries if exceeding limit to prevent storage bloat
    const keys = Object.keys(locations);
    if (keys.length > MAX_SAVED_LOCATIONS) {
      const sortedKeys = keys.sort((a, b) => (locations[a]?.timestamp ?? 0) - (locations[b]?.timestamp ?? 0));
      const toDelete = sortedKeys.slice(0, keys.length - MAX_SAVED_LOCATIONS);
      for (const key of toDelete) {
        delete locations[key];
      }
    }

    await this.storage.update(LOCATIONS_KEY, locations);
  }
}

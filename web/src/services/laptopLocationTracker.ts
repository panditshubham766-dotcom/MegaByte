export interface LaptopReading {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

type Listener = () => void;

class LaptopLocationTracker {
  private watchId: number | null = null;
  private readings: LaptopReading[] = [];
  private listeners: Set<Listener> = new Set();
  public isLocating: boolean = false;
  public isLocked: boolean = false;
  public lockedReading: LaptopReading | null = null;
  public error: string | null = null;
  public permissionDenied: boolean = false;
  public timeoutOccurred: boolean = false;
  private initialTimeoutId: any = null;
  private collectionTimeoutId: any = null;

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('Tracker listener error:', err);
      }
    });
  }

  private lockBestReading() {
    this.clearWatchAndTimers();
    if (this.readings.length > 0) {
      let best = this.readings[0];
      for (let i = 1; i < this.readings.length; i++) {
        if (this.readings[i].accuracy < best.accuracy) {
          best = this.readings[i];
        }
      }
      this.lockedReading = best;
      this.isLocked = true;
      this.isLocating = false;
      this.error = null;
      this.permissionDenied = false;
      this.timeoutOccurred = false;
    } else {
      this.isLocating = false;
      this.error = 'No location reading could be captured.';
    }
    this.notify();
  }

  private clearWatchAndTimers() {
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.collectionTimeoutId) {
      clearTimeout(this.collectionTimeoutId);
      this.collectionTimeoutId = null;
    }
    if (this.watchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Start the location lock capture flow:
   * Collects readings for up to 10 s, stopping early once accuracy <= 30 m,
   * then stops the watch and locks the reading with the best (smallest) accuracy.
   */
  public startLock() {
    if (this.isLocked && this.lockedReading) {
      return;
    }

    this.clearWatchAndTimers();
    this.readings = [];
    this.isLocating = true;
    this.isLocked = false;
    this.lockedReading = null;
    this.error = null;
    this.permissionDenied = false;
    this.timeoutOccurred = false;
    this.notify();

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.error = 'Geolocation is not supported by your browser.';
      this.isLocating = false;
      this.notify();
      return;
    }

    // 15 s timeout: if no reading arrives within 15 s show clear message with Retry
    this.initialTimeoutId = setTimeout(() => {
      if (this.readings.length === 0) {
        this.clearWatchAndTimers();
        this.isLocating = false;
        this.timeoutOccurred = true;
        this.error = 'No location reading arrived within 15 seconds.';
        this.notify();
      }
    }, 15000);

    let collectionStarted = false;

    const onPos = (pos: GeolocationPosition) => {
      // Clear 15s initial timeout once a reading arrives
      if (this.initialTimeoutId) {
        clearTimeout(this.initialTimeoutId);
        this.initialTimeoutId = null;
      }

      const reading: LaptopReading = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: Date.now(),
      };
      this.readings.push(reading);

      // Stop early once accuracy <= 30 m
      if (reading.accuracy <= 30) {
        this.lockBestReading();
        return;
      }

      // Collect readings for up to 10 s from first reading
      if (!collectionStarted) {
        collectionStarted = true;
        this.collectionTimeoutId = setTimeout(() => {
          this.lockBestReading();
        }, 10000);
      }
    };

    const onErr = (err: GeolocationPositionError) => {
      this.clearWatchAndTimers();
      this.isLocating = false;
      if (err.code === 1) {
        this.permissionDenied = true;
        this.error = 'Location permission was denied. Please allow location access in your browser settings.';
      } else if (err.code === 2) {
        this.error = 'Position unavailable. Please check device GPS/Wi-Fi.';
      } else if (err.code === 3) {
        this.timeoutOccurred = true;
        this.error = 'Location request timed out. Please retry.';
      } else {
        this.error = err.message || 'Unable to determine location.';
      }
      this.notify();
    };

    try {
      this.watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      });
    } catch (e: any) {
      this.clearWatchAndTimers();
      this.isLocating = false;
      this.error = e?.message || 'Failed to start geolocation.';
      this.notify();
    }
  }

  public relock() {
    this.isLocked = false;
    this.lockedReading = null;
    this.startLock();
  }

  public retry() {
    this.relock();
  }

  public stop() {
    this.clearWatchAndTimers();
    this.isLocating = false;
    this.notify();
  }
}

export const laptopTracker = new LaptopLocationTracker();

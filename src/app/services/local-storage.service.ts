import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {

  constructor() { }

  setItem(key: string, value: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      console.warn(`No se pudo guardar "${key}" en localStorage.`);
    }
  }

  getItem(key: string): any {
    const item = localStorage.getItem(key);
    if (item === null) {
      return null;
    }
    try {
      return JSON.parse(item);
    } catch {
      return null;
    }
  }

  removeItem(key: string): void {
    localStorage.removeItem(key);
  }

  clear(): void {
    localStorage.clear();
  }
}

import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { LocalStorageService } from './local-storage.service';

describe('LocalStorageService', () => {
  let service: LocalStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideExperimentalZonelessChangeDetection()],
    });
    service = TestBed.inject(LocalStorageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getItem devuelve null si el valor guardado no es JSON valido', () => {
    localStorage.setItem('corrupto', '{no es json');

    expect(service.getItem('corrupto')).toBeNull();

    localStorage.clear();
  });

  it('setItem no lanza si localStorage falla (p. ej. quota excedida)', () => {
    const original = localStorage.setItem;
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');

    expect(() => service.setItem('grande', 'x')).not.toThrow();

    localStorage.setItem = original;
  });
});

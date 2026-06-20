import { inject, Injectable } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

@Injectable({
  providedIn: 'root'
})
export class DataStorageSyncService {

  localStorageService = inject(LocalStorageService);

  constructor() { }
  
  saveCurrentFile(csvData: string){
    this.localStorageService.setItem("current-csv", csvData)
  };

  getCurrentFile(){
    return this.localStorageService.getItem("current-csv")
  }

  clearCurrentFile(){
    this.localStorageService.removeItem("current-csv")
  }

}

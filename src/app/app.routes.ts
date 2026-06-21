import { Routes } from '@angular/router';
import { DataImporterComponent } from './pages/data-importer/data-importer.component';

export const routes: Routes = [
    {
        path: "",
        redirectTo: "/importer",
        pathMatch: 'full'
    },
    {
        path: "importer",
        component: DataImporterComponent
    }
];

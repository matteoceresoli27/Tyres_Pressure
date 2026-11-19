# M4 GT4 Mileage – FS Motorsport

- **Car Mileage** – vita dei componenti della BMW M4 GT4 EVO (Technical Customer Manual V2.3, App. D)
- **Tyres Mileage** – magazzino gomme (Gara/Test, Slick/Rain), km per treno, allarmi 100/150/200 km

Chiunque apra il link vede e modifica gli stessi dati, aggiornati in diretta. Senza login, serve internet.

## Come funziona
- `server.js` gira su Render (Web Service gratuito): serve l'app e invia gli aggiornamenti in diretta.
- I dati sono salvati nel file `m4gt4-state.json` sul ramo **data** di questo repository
  (ogni modifica = un commit, quindi c'è anche lo storico). Il ramo `main` resta solo per il codice.

## Configurazione (una volta sola)
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
   - Repository access: *Only select repositories* → questo repository
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: la più lunga disponibile (annotarsi la scadenza e rinnovarlo)
2. Render → New → **Web Service** → collega questo repository
   - Runtime: Node · Build Command: `echo ok` · Start Command: `node server.js` · Instance type: **Free**
   - Environment: `GITHUB_TOKEN` = il token · `GITHUB_REPO` = `utente/nome-repository` · `DATA_BRANCH` = `data`

## Note sul piano gratuito di Render
Dopo 15 minuti senza visite il servizio va in pausa: alla prima apertura successiva serve circa un minuto
per ripartire. I dati non si perdono (sono su GitHub).

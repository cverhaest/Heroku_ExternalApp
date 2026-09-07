// @CVER
import express from 'express';
import fetch from 'node-fetch';
import { URLSearchParams } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL;
const SF_CLIENT_ID = process.env.SF_CLIENT_ID;
const SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET;
const SF_EXTERNAL_ID_FIELD = process.env.SF_EXTERNAL_ID_FIELD || 'Kheops_External_ID__c';
const SF_API_VERSION = process.env.SF_API_VERSION || 'v62.0';
const SF_RECORD_TYPE_DEVELOPER_NAME = process.env.SF_RECORD_TYPE_DEVELOPER_NAME || '';

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let _tokenCache = { token: null, expiresAt: 0 };

async function getSalesforceToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  const response = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OAuth error: ${error}`);
  }

  const data = await response.json();
  // expires_in est en secondes, on anticipe de 60s pour éviter les expirations en cours d'appel
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return _tokenCache.token;
}

async function getCaseStatusPicklistValues(token) {
  if (SF_RECORD_TYPE_DEVELOPER_NAME) {
    // Récupère l'ID du Record Type via SOQL
    const soql = encodeURIComponent(`SELECT Id FROM RecordType WHERE SObjectType = 'Case' AND DeveloperName = '${SF_RECORD_TYPE_DEVELOPER_NAME}' LIMIT 1`);
    const rtResponse = await fetch(
      `${SF_INSTANCE_URL}/services/data/${SF_API_VERSION}/query?q=${soql}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!rtResponse.ok) throw new Error('Impossible de récupérer le Record Type');
    const rtData = await rtResponse.json();
    if (!rtData.records || rtData.records.length === 0) throw new Error(`Record Type "${SF_RECORD_TYPE_DEVELOPER_NAME}" introuvable`);
    const recordTypeId = rtData.records[0].Id;

    // Valeurs de picklist filtrées par Record Type via UI API
    const plResponse = await fetch(
      `${SF_INSTANCE_URL}/services/data/${SF_API_VERSION}/ui-api/object-info/Case/picklist-values/${recordTypeId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!plResponse.ok) throw new Error('Impossible de récupérer les valeurs de picklist par Record Type');
    const plData = await plResponse.json();
    const statusValues = plData.picklistFieldValues?.Status?.values || [];
    return statusValues.map(v => v.value);
  }

  // Fallback : toutes les valeurs actives du champ
  const response = await fetch(
    `${SF_INSTANCE_URL}/services/data/${SF_API_VERSION}/sobjects/Case/describe`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) throw new Error('Impossible de récupérer les métadonnées Case');
  const describe = await response.json();
  const statusField = describe.fields.find(f => f.name === 'Status');
  return statusField ? statusField.picklistValues.filter(v => v.active).map(v => v.value) : [];
}

app.get('/', async (_req, res) => {
  try {
    const token = await getSalesforceToken();
    const statusValues = await getCaseStatusPicklistValues(token);
    res.render('index', { statusValues });
  } catch (err) {
    res.render('index', { statusValues: [] });
  }
});

app.get('/kheops', async (_req, res) => {
  try {
    const token = await getSalesforceToken();
    const statusValues = await getCaseStatusPicklistValues(token);
    res.render('kheops', { statusValues });
  } catch (err) {
    res.render('kheops', { statusValues: [] });
  }
});

app.post('/update-case', async (req, res) => {
  const { externalId, status } = req.body;

  try {
    const token = await getSalesforceToken();

    const response = await fetch(
      `${SF_INSTANCE_URL}/services/data/${SF_API_VERSION}/sobjects/Case/${SF_EXTERNAL_ID_FIELD}/${encodeURIComponent(externalId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ Status: status }),
      }
    );

    if (response.status === 204 || response.status === 200) {
      res.json({ success: true });
    } else {
      const errorBody = await response.json();
      const message = errorBody[0]?.message || `Erreur HTTP ${response.status}`;
      res.json({ success: false, error: message });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Kheops App démarrée sur le port ${PORT}`);
});

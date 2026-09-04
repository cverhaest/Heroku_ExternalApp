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

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.urlencoded({ extended: true }));

async function getSalesforceToken() {
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
  return data.access_token;
}

async function getCaseStatusPicklistValues(token) {
  const response = await fetch(
    `${SF_INSTANCE_URL}/services/data/${SF_API_VERSION}/sobjects/Case/describe`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) throw new Error('Impossible de récupérer les métadonnées Case');

  const describe = await response.json();
  const statusField = describe.fields.find(f => f.name === 'Status');
  return statusField ? statusField.picklistValues.filter(v => v.active).map(v => v.value) : [];
}

app.get('/', async (req, res) => {
  const { externalId, status, error } = req.query;
  try {
    const token = await getSalesforceToken();
    const statusValues = await getCaseStatusPicklistValues(token);
    const result = externalId && status ? { externalId, status } : null;
    res.render('index', { statusValues, result, error: error || null });
  } catch (err) {
    res.render('index', { statusValues: [], result: null, error: err.message });
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
      res.redirect(`/?externalId=${encodeURIComponent(externalId)}&status=${encodeURIComponent(status)}`);
    } else {
      const errorBody = await response.json();
      const message = errorBody[0]?.message || `Erreur HTTP ${response.status}`;
      res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

app.listen(PORT, () => {
  console.log(`Kheops App démarrée sur le port ${PORT}`);
});

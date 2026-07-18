/**
 * MindfulDay push notification functions.
 * Web Push (VAPID) - subscriptions live in RTDB /pushSubs/<deviceId>.
 */

const { onValueWritten } = require('firebase-functions/v2/database');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const webpush = require('web-push');

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
const VAPID_PUBLIC_KEY = 'BIwhlC6aQXGcLz26tVB6SoKQnPA_D0h2eO93jfSuwmXOCgZMcApXNdQnxdTwcIonHqeLMoqQJ0784h3yykUOLfI';

admin.initializeApp();

// Send a payload to every registered device; prune dead subscriptions.
async function sendToAll(payloadObj) {
    const subsSnap = await admin.database().ref('/pushSubs').get();
    const subs = subsSnap.val() || {};
    const payload = JSON.stringify(payloadObj);
    const results = [];

    for (const [id, sub] of Object.entries(subs)) {
        try {
            await webpush.sendNotification(sub, payload);
            results.push(id + ':ok');
        } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
                await admin.database().ref('/pushSubs/' + id).remove();
                results.push(id + ':pruned');
            } else {
                results.push(id + ':error ' + e.statusCode);
            }
        }
    }
    return results;
}

// Test push: the app writes /pushTest, we wait ~12s (time to lock the
// phone), then notify every device and clean up the request.
exports.sendtestpush = onValueWritten(
    {
        ref: '/pushTest',
        instance: 'mindfulday-gsb-default-rtdb',
        region: 'asia-southeast1',
        secrets: [VAPID_PRIVATE_KEY]
    },
    async (event) => {
        if (!event.data.after.exists()) return; // our own cleanup delete

        webpush.setVapidDetails(
            'mailto:gs.bellu@gmail.com',
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY.value()
        );

        await new Promise((resolve) => setTimeout(resolve, 12000));

        const results = await sendToAll({
            title: 'MindfulDay 🔔',
            body: 'Push works! Tap to open the app.'
        });
        console.log('Test push results:', results.join(', '));

        await admin.database().ref('/pushTest').remove();
    }
);

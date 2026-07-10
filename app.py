import cv2
import numpy as np
import tensorflow as tf
import base64
import threading
import os
from collections import Counter
from flask import Flask, Response, request, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')


MODEL_PATH = os.path.join(BASE_DIR, 'hand_sign_model.keras')
print(f"Loading model: {MODEL_PATH}")
model = tf.keras.models.load_model(MODEL_PATH)
print("Model OK")

CLASS_NAMES = sorted([
    'A','B','C','D','E','F','G','H','I','J','K','L','M',
    'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    'del','nothing','space'
])
lock = threading.Lock()
state = {
    "label"        : "nothing",
    "confidence"   : 0.0,
    "progress"     : 0.0,
    "current_text" : "",
    "sentences"    : [],
    "cam_on"       : False,
}
recent_preds  = []
cooldown      = 0

CONF_THRESHOLD  = 0.70
CONFIRM_FRAMES  = 20
COOLDOWN_FRAMES = 18
ROI_SIZE        = 240

cam_thread  = None
stop_cam    = threading.Event()

def predict(roi):
    roi = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
    img = cv2.resize(roi, (64, 64)).astype("float32")
    preds = model.predict(np.expand_dims(img, 0), verbose=0)[0]
    idx = int(np.argmax(preds))
    return CLASS_NAMES[idx], float(preds[idx]), preds

def apply_char(label):
    if label == "space":
        state["current_text"] += " "
    elif label == "del":
        state["current_text"] = state["current_text"][:-1]
    elif label != "nothing":
        state["current_text"] += label.upper()

def camera_worker():
    global cooldown, recent_preds
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        with lock:
            state["cam_on"] = False
        return
    while not stop_cam.is_set():
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.flip(frame, 1)
        h, w  = frame.shape[:2]

        x1 = (w - ROI_SIZE) // 2
        y1 = (h - ROI_SIZE) // 2
        x2, y2 = x1 + ROI_SIZE, y1 + ROI_SIZE
        roi = frame[y1:y2, x1:x2]

        label, conf, preds = predict(roi)

        with lock:
            state["label"]      = label
            state["confidence"] = round(conf, 4)

            if cooldown == 0 and conf >= CONF_THRESHOLD:
                recent_preds.append(label)
                if len(recent_preds) > CONFIRM_FRAMES:
                    recent_preds.pop(0)
                if len(recent_preds) == CONFIRM_FRAMES:
                    top, cnt = Counter(recent_preds).most_common(1)[0]
                    if cnt >= int(CONFIRM_FRAMES * 0.8):
                        apply_char(top)
                        recent_preds.clear()
                        cooldown = COOLDOWN_FRAMES
            elif cooldown > 0:
                cooldown -= 1
            state["progress"] = round(len(recent_preds) / CONFIRM_FRAMES, 3)
        color = (0, 220, 100) if conf >= CONF_THRESHOLD else (60, 130, 255)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            with frame_lock:
                frame_buffer[0] = buf.tobytes()

    cap.release()
    with lock:
        state["cam_on"] = False
        state["label"] = "nothing"
        state["confidence"] = 0.0
        state["progress"] = 0.0
    with frame_lock:
        frame_buffer[0] = None

frame_lock   = threading.Lock()
frame_buffer = [None]

def gen_frames():
    import time
    while True:
        with frame_lock:
            data = frame_buffer[0]
        if data:
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                   + data + b"\r\n")
        else:
            time.sleep(0.05)
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/video")
def video():
    return Response(gen_frames(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")

@app.route("/state")
def get_state():
    with lock:
        return jsonify(dict(state))

@app.route("/camera", methods=["POST"])
def camera_control():
    global cam_thread, stop_cam, recent_preds, cooldown
    data = request.get_json(force=True)
    action = data.get("action")

    if action == "start":
        with lock:
            if state["cam_on"]:
                return jsonify({"ok": True, "cam_on": True})
        stop_cam.clear()
        recent_preds = []
        cooldown = 0
        cam_thread = threading.Thread(target=camera_worker, daemon=True)
        cam_thread.start()
        with lock:
            state["cam_on"] = True
        return jsonify({"ok": True, "cam_on": True})

    elif action == "stop":
        stop_cam.set()
        with lock:
            state["cam_on"] = False
        return jsonify({"ok": True, "cam_on": False})

    return jsonify({"error": "unknown action"}), 400

@app.route("/action", methods=["POST"])
def action():
    data = request.get_json(force=True)
    act  = data.get("action", "")
    with lock:
        if act == "space":
            state["current_text"] += " "
        elif act == "delete":
            state["current_text"] = state["current_text"][:-1]
        elif act == "clear":
            state["current_text"] = ""
        elif act == "add_char":
            apply_char(data.get("label", ""))
        elif act == "finish":
            txt = state["current_text"].strip()
            if txt:
                s = txt.capitalize()
                if s[-1] not in ".!?":
                    s += "."
                state["sentences"].append(s)
                state["current_text"] = ""
        elif act == "delete_sentence":
            idx = data.get("idx", -1)
            if 0 <= idx < len(state["sentences"]):
                state["sentences"].pop(idx)
    return jsonify({"ok": True})

@app.route("/predict_image", methods=["POST"])
def predict_image():
    try:
        data   = request.get_json(force=True)
        b64    = data.get("image", "").split(",")[-1]
        imgArr = np.frombuffer(base64.b64decode(b64), np.uint8)
        img    = cv2.imdecode(imgArr, cv2.IMREAD_COLOR)
        if img is None:
            return jsonify({"error": "Không đọc được ảnh"})
        label, conf, preds = predict(img)
        top5 = [
            {"name": CLASS_NAMES[i].upper(), "conf": round(float(preds[i]), 4)}
            for i in np.argsort(preds)[::-1][:5]
        ]
        return jsonify({"label": label, "confidence": round(conf, 4), "top5": top5})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("Server running at http://localhost:5000")
    app.run(host="0.0.0.0", port=5000,
            debug=False, use_reloader=False, threaded=True)

import streamlit as st
import numpy as np
import tensorflow as tf
from PIL import Image
from collections import Counter
import tempfile
import os
import time
import pathlib

st.set_page_config(
    page_title = "ASL Hand Sign Recognition",
    page_icon ="🤟",
    layout ="wide"
)

def load_css(file_path):
    with open (file_path) as f:
        st.html(f"<style>{f.read()}</style>)")

css_path = pathlib.Path("style.css")
load_css(css_path)

def load_model():
    model = tf.keras.models.load_model("hand_sign_model.keras")
    class_names = sorted(['A','B','C','D','E','F','G','H','I','K',
                          'L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','del','nothing','space'])
    return model, class_names

model, class_names = load_model()


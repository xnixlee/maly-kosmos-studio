# Third-party components and model weights

No neural weights, Python environments, vendor repositories or user data are distributed with this repository. The MIT license covers this project's code and example content, not independently downloaded models or character/trademark rights.

- **MLX / MLX-LM**: https://github.com/ml-explore/mlx-lm — MIT; installed separately.
- **Qwen3 4B Instruct 2507**: https://huggingface.co/mlx-community/Qwen3-4B-Instruct-2507-4bit — Apache-2.0 model card; pinned revision in `config/catalog.json`.
- **Silero**: https://github.com/snakers4/silero-models — consult the repository and model terms. Russian v5 file downloaded separately and checked against its recorded SHA-256.
- **OpenAI Whisper**: https://github.com/openai/whisper — MIT; base weights downloaded using the upstream URL and hash.
- **Stable-ts**: https://github.com/jianfch/stable-ts — MIT.
- **RVC MLX**: https://github.com/Acelogic/Retrieval-based-Voice-Conversion-MLX — upstream package metadata declares MIT; pinned commit downloaded into the ignored `vendor/` directory.
- **ContentVec / RMVPE assets**: https://huggingface.co/IAHispano/Applio — retrieved separately from a pinned repository revision; see upstream model terms.
- **Russian SpongeBob voice**: https://huggingface.co/iamalexcaspian/SpongeBob-SquarePants-Russian — optional user download; project does not grant rights to the weights, character or performance.
- **Cartman / Zhirinovsky voice models**: https://huggingface.co/niobures/RVC-Models — optional user download; consult the uploader's model terms. Where a model license is not clearly stated, no permissive weight license is inferred.
- **ffmpeg-static**: https://github.com/eugeneware/ffmpeg-static — GPL-3.0 package; downloaded binaries may have their own LGPL/GPL build configuration. The binary is not committed to this source repository. If distributing binaries, preserve applicable notices and comply with the licenses of the specific build.

The local speech worker and conversion integration were adapted from the project owner's local mememaker implementation. The external mememaker project is not required for a fresh installation and is not bundled.

Generated example illustrations were created for this project with ImageGen. Names of third-party voice models identify optional compatible downloads, not affiliation or endorsement.

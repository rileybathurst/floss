#!/usr/bin/env bash

source "$(dirname "$0")/.env"

script_directory="$(cd "$(dirname "$0")" && pwd)"
base_directory="${base_directory%/}"
filename="parent-projects-$(date +%Y-%m-%d).csv"
remote_csv_path="floss/output/$filename"
error_output="$(mktemp)"
available_files="$(mktemp)"
selected_file="$(mktemp)"
trap 'rm -f "$error_output" "$available_files" "$selected_file"' EXIT

if ! scp "$remote:$base_directory/$remote_csv_path" ./output 2>"$error_output"; then
	cat "$error_output" >&2

	if ! grep -Fq "scp: $base_directory/$remote_csv_path: No such file or directory" "$error_output"; then
		exit 1
	fi

	echo "Today's export was not found. Available files:"
	ssh "$remote" "ls -1 '$base_directory/floss/output'" >"$available_files" || exit 1
	npm run build --silent --prefix "$script_directory" || exit 1
	node "$script_directory/dist/choose-parent-project-file.js" "$available_files" "$selected_file" || exit 1
	filename="$(<"$selected_file")"

	if [[ ! "$filename" =~ ^[A-Za-z0-9._-]+$ ]]; then
		echo "The selected filename contains unsupported characters." >&2
		exit 1
	fi

	scp "$remote:$base_directory/floss/output/$filename" ./output || exit 1
fi

npm run build --silent --prefix "$script_directory" || exit 1
node "$script_directory/dist/download-project-readmes.js" "./output/$filename" "$remote" ./output


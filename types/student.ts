export interface Level {
    name: string;
    value: number;
}

export interface StudentSnapshot {
    student_id: string;
    levels: Level[];
    weak_areas: string[];
    strong_areas: string[];
    desired_difficulty_level: number;
    recent_history: any[];
}

export interface Question {
    question_id: string;
    question_text: string;
    options: {
        option_label: string;
        option_text: string;
        is_correct: boolean;
        explanation: string;
    }[];
}